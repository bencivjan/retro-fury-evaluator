#!/usr/bin/env node
// browser-arena.js - Puppeteer-based multiplayer arena test
//
// Launches 2 real browser instances, runs a full Gun Game match via
// eval-server test hooks, and captures evidence (screenshots + JSON).
//
// Usage:
//   node tools/browser-arena.js [submission-id] [options]
//
// Options:
//   --headless          Run browsers in headless mode (for CI)
//   --timeout <ms>      Match timeout in ms (default: 120000)
//   --no-servers        Skip starting game/eval servers (assume already running)
//   --screenshot-dir <dir>  Directory for screenshots (default: ./arena-screenshots)
//   --verbose           Enable verbose logging

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// =========================================================================
// Arg parsing
// =========================================================================
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        submissionId: null,
        headless: false,
        timeout: 120_000,
        startServers: true,
        screenshotDir: null,
        verbose: false,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--headless':
                opts.headless = true;
                break;
            case '--timeout':
                opts.timeout = parseInt(args[++i], 10);
                break;
            case '--no-servers':
                opts.startServers = false;
                break;
            case '--screenshot-dir':
                opts.screenshotDir = args[++i];
                break;
            case '--verbose':
                opts.verbose = true;
                break;
            default:
                if (!args[i].startsWith('-')) {
                    opts.submissionId = args[i];
                }
        }
    }

    return opts;
}

// =========================================================================
// Helpers
// =========================================================================
function log(msg) { console.error(`[browser-arena] ${msg}`); }
function vlog(msg, verbose) { if (verbose) console.error(`[browser-arena][v] ${msg}`); }

function resolveSubmission(id) {
    const dir = path.join(REPO_ROOT, 'submissions');
    if (id) {
        const full = path.join(dir, id);
        if (fs.existsSync(full)) return { id, dir: full };
        throw new Error(`Submission not found: ${full}`);
    }
    const entries = fs.readdirSync(dir).filter(e => e !== '.gitkeep').sort().reverse();
    if (entries.length === 0) throw new Error('No submissions found');
    return { id: entries[0], dir: path.join(dir, entries[0]) };
}

async function waitForUrl(url, timeoutMs = 15_000, intervalMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const resp = await fetch(url);
            if (resp.ok) return true;
        } catch { /* not ready yet */ }
        await sleep(intervalMs);
    }
    return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

// =========================================================================
// Server management
// =========================================================================
function startServer(cmd, args, cwd, label) {
    const proc = spawn(cmd, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });
    proc.stdout.on('data', d => vlog(`[${label}] ${d.toString().trim()}`, true));
    proc.stderr.on('data', d => vlog(`[${label}] ${d.toString().trim()}`, true));
    proc.on('error', e => log(`[${label}] spawn error: ${e.message}`));
    return proc;
}

// =========================================================================
// Screenshot helper
// =========================================================================
async function screenshot(page, dir, name) {
    if (!dir) return null;
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
}

// =========================================================================
// Main orchestration
// =========================================================================
async function run() {
    const opts = parseArgs();
    const submission = resolveSubmission(opts.submissionId);
    const screenshotDir = opts.screenshotDir || path.join(REPO_ROOT, 'arena-screenshots');

    log(`Submission: ${submission.id} (${submission.dir})`);
    log(`Headless: ${opts.headless}, Timeout: ${opts.timeout}ms`);

    const results = [];
    let passCount = 0;
    let failCount = 0;
    const serverProcs = [];
    const browsers = [];
    let matchResult = { outcome: 'timeout', winnerId: null, duration: 0 };

    function addResult(checkId, result, evidence) {
        results.push({ check_id: checkId, result, evidence });
        if (result === 'PASS') passCount++;
        else failCount++;
    }

    async function cleanup() {
        for (const b of browsers) {
            try { await b.close(); } catch { /* ignore */ }
        }
        for (const p of serverProcs) {
            try {
                p.kill('SIGTERM');
                await sleep(1000);
                if (!p.killed) p.kill('SIGKILL');
            } catch { /* ignore */ }
        }
    }

    try {
        // ---------------------------------------------------------------
        // Stage 1: Start servers
        // ---------------------------------------------------------------
        if (opts.startServers) {
            log('Starting game server...');
            // Install server deps if needed
            const serverDir = path.join(submission.dir, 'server');
            if (fs.existsSync(path.join(serverDir, 'package.json')) &&
                !fs.existsSync(path.join(serverDir, 'node_modules'))) {
                execSync('npm install --silent', { cwd: serverDir, stdio: 'ignore' });
            }

            const gameServer = startServer('node', ['index.js'], serverDir, 'game-server');
            serverProcs.push(gameServer);

            log('Starting eval-server...');
            const evalServer = startServer(
                'python3',
                [path.join(REPO_ROOT, 'tools', 'eval-server.py'), submission.dir],
                submission.dir,
                'eval-server'
            );
            serverProcs.push(evalServer);

            // Wait for both servers
            const [gameReady, evalReady] = await Promise.all([
                waitForUrl('http://localhost:3000', 15_000),
                waitForUrl('http://localhost:8888', 15_000),
            ]);

            if (!gameReady) {
                addResult('arena_browsers_loaded', 'FAIL', 'Game server (port 3000) failed to start within 15s');
                throw new Error('Game server not ready');
            }
            if (!evalReady) {
                addResult('arena_browsers_loaded', 'FAIL', 'Eval server (port 8888) failed to start within 15s');
                throw new Error('Eval server not ready');
            }
            log('Both servers ready.');
        }

        // ---------------------------------------------------------------
        // Stage 2: Launch browsers
        // ---------------------------------------------------------------
        log('Launching browsers...');
        const launchOpts = {
            headless: opts.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--autoplay-policy=no-user-gesture-required',
                '--use-fake-ui-for-media-stream',
            ],
        };

        const [browser1, browser2] = await Promise.all([
            puppeteer.launch(launchOpts),
            puppeteer.launch(launchOpts),
        ]);
        browsers.push(browser1, browser2);

        const page1 = await browser1.newPage();
        const page2 = await browser2.newPage();
        await page1.setViewport({ width: 800, height: 600 });
        await page2.setViewport({ width: 800, height: 600 });

        // Collect console errors from both pages
        const jsErrors = [];
        for (const [label, page] of [['P1', page1], ['P2', page2]]) {
            page.on('console', msg => {
                if (msg.type() === 'error') {
                    jsErrors.push({ player: label, text: msg.text() });
                }
                vlog(`[${label}] ${msg.text()}`, opts.verbose);
            });
            page.on('pageerror', err => {
                jsErrors.push({ player: label, text: err.message });
            });
        }

        // Navigate both to eval-server
        log('Loading game in both browsers...');
        await Promise.all([
            page1.goto('http://localhost:8888', { waitUntil: 'networkidle2', timeout: 30_000 }),
            page2.goto('http://localhost:8888', { waitUntil: 'networkidle2', timeout: 30_000 }),
        ]);

        // Wait for _test hooks to be available
        const hooksReady = await Promise.all([
            page1.waitForFunction(() => window._test && typeof window._test.hostGame === 'function', { timeout: 15_000 }).then(() => true).catch(() => false),
            page2.waitForFunction(() => window._test && typeof window._test.joinGame === 'function', { timeout: 15_000 }).then(() => true).catch(() => false),
        ]);

        if (!hooksReady[0] || !hooksReady[1]) {
            addResult('arena_browsers_loaded', 'FAIL',
                `Test hooks not available: P1=${hooksReady[0]}, P2=${hooksReady[1]}`);
            throw new Error('Test hooks not ready');
        }

        addResult('arena_browsers_loaded', 'PASS',
            'Both browser instances loaded game with test hooks available');
        await screenshot(page1, screenshotDir, '01-p1-loaded');
        await screenshot(page2, screenshotDir, '02-p2-loaded');

        // ---------------------------------------------------------------
        // Stage 3: Room create/join flow
        // ---------------------------------------------------------------
        log('P1 hosting game...');
        await page1.evaluate(() => window._test.hostGame());
        // Wait for room code to appear
        let roomCode = null;
        for (let i = 0; i < 20; i++) {
            await sleep(500);
            roomCode = await page1.evaluate(() => window._test.getRoomCode());
            if (roomCode) break;
        }

        if (!roomCode) {
            addResult('arena_room_flow', 'FAIL', 'Room code not generated after hosting');
            throw new Error('No room code');
        }
        log(`Room code: ${roomCode}`);
        await screenshot(page1, screenshotDir, '03-p1-hosting');

        log(`P2 joining room ${roomCode}...`);
        await page2.evaluate((code) => window._test.joinGame(code), roomCode);
        await sleep(1000);

        // Verify both are in lobby
        const [p1Lobby, p2Lobby] = await Promise.all([
            page1.evaluate(() => window._test.getState()),
            page2.evaluate(() => window._test.getState()),
        ]);

        const lobbyStates = [p1Lobby.gameState, p2Lobby.gameState];
        // GameState.LOBBY = 8
        if (lobbyStates.includes(8)) {
            addResult('arena_room_flow', 'PASS',
                `Room create/join succeeded. Room code: ${roomCode}. States: P1=${p1Lobby.gameState}, P2=${p2Lobby.gameState}`);
        } else {
            addResult('arena_room_flow', 'FAIL',
                `Room flow incomplete. States: P1=${p1Lobby.gameState}, P2=${p2Lobby.gameState}`);
        }
        await screenshot(page2, screenshotDir, '04-p2-joined');

        // ---------------------------------------------------------------
        // Stage 4: Ready up and start
        // ---------------------------------------------------------------
        log('Both players readying up...');
        await page1.evaluate(() => window._test.ready());
        await sleep(500);
        await page2.evaluate(() => window._test.ready());

        // Wait for MP_PLAYING (gameState === 9)
        let gameStarted = false;
        for (let i = 0; i < 30; i++) {
            await sleep(500);
            const [s1, s2] = await Promise.all([
                page1.evaluate(() => window._test.getState()),
                page2.evaluate(() => window._test.getState()),
            ]);
            vlog(`Waiting for start: P1=${s1.gameState}, P2=${s2.gameState}`, opts.verbose);
            if (s1.gameState === 9 && s2.gameState === 9) {
                gameStarted = true;
                break;
            }
            // Also accept if one is MP_PLAYING and the other is catching up
            if (s1.gameState === 9 || s2.gameState === 9) {
                // Give a bit more time for the other
                continue;
            }
        }

        if (gameStarted) {
            addResult('arena_game_started', 'PASS',
                'Both browsers transitioned to MP_PLAYING (gameState=9) after ready');
        } else {
            const [s1, s2] = await Promise.all([
                page1.evaluate(() => window._test.getState()),
                page2.evaluate(() => window._test.getState()),
            ]);
            addResult('arena_game_started', 'FAIL',
                `Game did not start. Final states: P1=${s1.gameState}, P2=${s2.gameState}`);
            throw new Error('Game did not start');
        }
        await screenshot(page1, screenshotDir, '05-game-started-p1');
        await screenshot(page2, screenshotDir, '06-game-started-p2');

        // ---------------------------------------------------------------
        // Stage 5: Click canvas for pointer lock + start auto-combat
        // ---------------------------------------------------------------
        log('Clicking canvas for pointer lock...');
        for (const page of [page1, page2]) {
            await page.click('canvas').catch(() => {});
            await sleep(200);
        }

        log('Enabling auto-combat on both browsers...');
        await page1.evaluate(() => window._startAutoP1());
        await page2.evaluate(() => window._startAutoP1());

        // ---------------------------------------------------------------
        // Stage 6: Monitor match
        // ---------------------------------------------------------------
        log('Monitoring match...');
        const matchStart = Date.now();
        let screenshotCounter = 0;
        let lastScreenshotTime = 0;
        let victoryReached = false;
        let tierProgressed = false;
        let maxLocalTier1 = 0;
        let maxLocalTier2 = 0;

        while (Date.now() - matchStart < opts.timeout) {
            const [status1, status2] = await Promise.all([
                page1.evaluate(() => window._getMpStatus()).catch(() => null),
                page2.evaluate(() => window._getMpStatus()).catch(() => null),
            ]);

            if (!status1 || !status2) {
                vlog('Failed to get status from one or both pages', opts.verbose);
                await sleep(500);
                continue;
            }

            // Track tier progression
            if (status1.localTier > maxLocalTier1) maxLocalTier1 = status1.localTier;
            if (status2.localTier > maxLocalTier2) maxLocalTier2 = status2.localTier;
            if (maxLocalTier1 > 0 || maxLocalTier2 > 0) tierProgressed = true;

            vlog(`P1: state=${status1.gameState} tier=${status1.localTier} hp=${status1.playerHP} alive=${status1.playerAlive}`, opts.verbose);
            vlog(`P2: state=${status2.gameState} tier=${status2.localTier} hp=${status2.playerHP} alive=${status2.playerAlive}`, opts.verbose);

            // Check for victory (gameState === 11)
            if (status1.gameState === 11 || status2.gameState === 11) {
                victoryReached = true;
                const winnerId = status1.winnerId || status2.winnerId;
                matchResult = {
                    outcome: 'victory',
                    winnerId,
                    duration: (Date.now() - matchStart) / 1000,
                    p1FinalTier: status1.localTier,
                    p2FinalTier: status2.localTier,
                };
                log(`Victory! Winner: ${winnerId}, Duration: ${matchResult.duration.toFixed(1)}s`);
                await screenshot(page1, screenshotDir, '99-victory-p1');
                await screenshot(page2, screenshotDir, '99-victory-p2');
                break;
            }

            // Check for loop errors
            if (status1.loopError || status2.loopError) {
                log(`Loop error detected: P1=${status1.loopError}, P2=${status2.loopError}`);
            }

            // Periodic screenshots (every 5s)
            const elapsed = Date.now() - matchStart;
            if (elapsed - lastScreenshotTime >= 5000) {
                screenshotCounter++;
                await screenshot(page1, screenshotDir, `match-${String(screenshotCounter).padStart(3, '0')}-p1`);
                await screenshot(page2, screenshotDir, `match-${String(screenshotCounter).padStart(3, '0')}-p2`);
                lastScreenshotTime = elapsed;
                log(`Match in progress... ${(elapsed / 1000).toFixed(0)}s elapsed, P1 tier=${status1.localTier}, P2 tier=${status2.localTier}`);
            }

            await sleep(500);
        }

        if (!victoryReached) {
            matchResult = {
                outcome: 'timeout',
                winnerId: null,
                duration: opts.timeout / 1000,
                p1FinalTier: maxLocalTier1,
                p2FinalTier: maxLocalTier2,
            };
            await screenshot(page1, screenshotDir, '99-timeout-p1');
            await screenshot(page2, screenshotDir, '99-timeout-p2');
        }

        // ---------------------------------------------------------------
        // Stage 7: Evaluate results
        // ---------------------------------------------------------------

        // JS errors check - filter out known benign errors
        const criticalErrors = jsErrors.filter(e =>
            !e.text.includes('favicon') &&
            !e.text.includes('net::ERR') &&
            !e.text.includes('AudioContext')
        );

        if (criticalErrors.length === 0) {
            addResult('arena_no_errors', 'PASS',
                `No JS runtime errors during match (${jsErrors.length} benign errors filtered)`);
        } else {
            addResult('arena_no_errors', 'FAIL',
                `${criticalErrors.length} JS errors: ${criticalErrors.slice(0, 3).map(e => `[${e.player}] ${e.text}`).join('; ')}`);
        }

        // Match outcome
        if (victoryReached) {
            addResult('arena_match_outcome', 'PASS',
                `Match completed with victory. Winner: ${matchResult.winnerId}, Duration: ${matchResult.duration.toFixed(1)}s`);
        } else {
            addResult('arena_match_outcome', 'FAIL',
                `Match timed out after ${opts.timeout / 1000}s without victory. P1 tier=${maxLocalTier1}, P2 tier=${maxLocalTier2}`);
        }

        // Tier progression
        if (tierProgressed) {
            addResult('arena_tier_progression', 'PASS',
                `Gun Game tier progression observed. P1 max tier=${maxLocalTier1}, P2 max tier=${maxLocalTier2}`);
        } else {
            addResult('arena_tier_progression', 'FAIL',
                'No weapon tier progression observed during match');
        }

    } catch (err) {
        log(`Error: ${err.message}`);
        // Ensure we have results for all checks even on early exit
        const checkedIds = results.map(r => r.check_id);
        const allChecks = [
            'arena_browsers_loaded', 'arena_room_flow', 'arena_game_started',
            'arena_no_errors', 'arena_match_outcome', 'arena_tier_progression',
        ];
        for (const id of allChecks) {
            if (!checkedIds.includes(id)) {
                addResult(id, 'FAIL', `Skipped due to earlier failure: ${err.message}`);
            }
        }
    } finally {
        await cleanup();
    }

    // ---------------------------------------------------------------
    // Output JSON
    // ---------------------------------------------------------------
    const output = {
        tool: 'browser-arena',
        submission: submission.id,
        summary: { pass: passCount, fail: failCount },
        matchResult,
        results,
    };

    console.log(JSON.stringify(output, null, 2));
}

run().catch(err => {
    console.error(`[browser-arena] Fatal: ${err.message}`);
    // Output minimal valid JSON so the pipeline can still parse results
    console.log(JSON.stringify({
        tool: 'browser-arena',
        submission: 'unknown',
        summary: { pass: 0, fail: 1 },
        matchResult: { outcome: 'error', winnerId: null, duration: 0 },
        results: [{ check_id: 'arena_browsers_loaded', result: 'FAIL', evidence: err.message }],
    }, null, 2));
    process.exit(1);
});
