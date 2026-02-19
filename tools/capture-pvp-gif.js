#!/usr/bin/env node
// capture-pvp-gif.js - Run a multiplayer match and create side-by-side GIFs
//
// Launches 2 browsers, plays a full Gun Game match with auto-combat,
// captures canvas frames at ~5fps, and encodes animated GIFs.
//
// Usage: node tools/capture-pvp-gif.js [--headless] [--output-dir <dir>]

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const CAPTURE_INTERVAL_MS = 200; // ~5 fps
const MATCH_TIMEOUT_MS = 300_000; // 5 minutes max
const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 200;
const GIF_SCALE = 2; // Scale up for visibility
const OUT_WIDTH = CANVAS_WIDTH * GIF_SCALE;
const OUT_HEIGHT = CANVAS_HEIGHT * GIF_SCALE;

// =========================================================================
// Args
// =========================================================================
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        headless: false,
        outputDir: path.join(REPO_ROOT, 'eval-gifs', 'agent-pvp'),
        verbose: false,
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--headless') opts.headless = true;
        else if (args[i] === '--output-dir') opts.outputDir = args[++i];
        else if (args[i] === '--verbose') opts.verbose = true;
    }
    return opts;
}

function log(msg) { console.error(`[capture] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function resolveSubmission() {
    const dir = path.join(REPO_ROOT, 'submissions');
    const entries = fs.readdirSync(dir).filter(e => e !== '.gitkeep').sort().reverse();
    if (entries.length === 0) throw new Error('No submissions found');
    return { id: entries[0], dir: path.join(dir, entries[0]) };
}

async function waitForUrl(url, timeoutMs = 15_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const resp = await fetch(url);
            if (resp.ok) return true;
        } catch { /* not ready */ }
        await sleep(500);
    }
    return false;
}

// =========================================================================
// Canvas capture - gets raw PNG buffer from game canvas via data URL
// =========================================================================
async function captureCanvas(page) {
    try {
        const dataUrl = await page.evaluate(() => {
            const canvas = document.getElementById('game-canvas');
            if (!canvas) return null;
            return canvas.toDataURL('image/png');
        });
        if (!dataUrl) return null;
        const base64 = dataUrl.split(',')[1];
        return Buffer.from(base64, 'base64');
    } catch {
        return null;
    }
}

// =========================================================================
// GIF encoding
// =========================================================================
async function createGif(frames, width, height, delayMs, outputPath) {
    log(`Encoding GIF: ${frames.length} frames, ${width}x${height}, ${delayMs}ms delay -> ${outputPath}`);
    const gif = GIFEncoder();

    for (let i = 0; i < frames.length; i++) {
        if (i % 50 === 0) log(`  Processing frame ${i + 1}/${frames.length}...`);
        const { data } = await sharp(frames[i])
            .resize(width, height, { fit: 'fill' })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const rgba = new Uint8Array(data);
        const palette = quantize(rgba, 256);
        const index = applyPalette(rgba, palette);
        gif.writeFrame(index, width, height, { palette, delay: delayMs });
    }

    gif.finish();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, gif.bytes());
    log(`Saved: ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB)`);
}

async function createSideBySideGif(p1Frames, p2Frames, outputPath, delayMs) {
    const count = Math.min(p1Frames.length, p2Frames.length);
    log(`Creating side-by-side GIF: ${count} frames`);

    const gap = 4 * GIF_SCALE;
    const totalWidth = OUT_WIDTH * 2 + gap;
    const composited = [];

    for (let i = 0; i < count; i++) {
        if (i % 50 === 0) log(`  Compositing frame ${i + 1}/${count}...`);
        const p1 = await sharp(p1Frames[i]).resize(OUT_WIDTH, OUT_HEIGHT, { fit: 'fill' }).toBuffer();
        const p2 = await sharp(p2Frames[i]).resize(OUT_WIDTH, OUT_HEIGHT, { fit: 'fill' }).toBuffer();

        const frame = await sharp({
            create: {
                width: totalWidth,
                height: OUT_HEIGHT,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 255 },
            }
        })
        .composite([
            { input: p1, left: 0, top: 0 },
            { input: p2, left: OUT_WIDTH + gap, top: 0 },
        ])
        .png()
        .toBuffer();

        composited.push(frame);
    }

    await createGif(composited, totalWidth, OUT_HEIGHT, delayMs, outputPath);
}

// =========================================================================
// Main
// =========================================================================
async function main() {
    const opts = parseArgs();
    const submission = resolveSubmission();
    log(`Submission: ${submission.id}`);
    log(`Output: ${opts.outputDir}`);

    const serverProcs = [];
    const browsers = [];

    async function cleanup() {
        for (const b of browsers) {
            try { await b.close(); } catch { /* */ }
        }
        for (const p of serverProcs) {
            try { p.kill('SIGTERM'); } catch { /* */ }
        }
        await sleep(500);
        for (const p of serverProcs) {
            try { if (!p.killed) p.kill('SIGKILL'); } catch { /* */ }
        }
    }

    try {
        // --- Start servers ---
        log('Starting game server...');
        const serverDir = path.join(submission.dir, 'server');
        if (fs.existsSync(path.join(serverDir, 'package.json')) &&
            !fs.existsSync(path.join(serverDir, 'node_modules'))) {
            execSync('npm install --silent', { cwd: serverDir, stdio: 'ignore' });
        }

        const gameServer = spawn('node', ['index.js'], {
            cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
        });
        serverProcs.push(gameServer);
        gameServer.stderr.on('data', d => opts.verbose && log(`[game] ${d}`));

        log('Starting eval-server...');
        const evalServer = spawn('python3', [
            path.join(REPO_ROOT, 'tools', 'eval-server.py'), submission.dir,
        ], { cwd: submission.dir, stdio: ['ignore', 'pipe', 'pipe'], detached: false });
        serverProcs.push(evalServer);
        evalServer.stderr.on('data', d => opts.verbose && log(`[eval] ${d}`));

        const [gameOk, evalOk] = await Promise.all([
            waitForUrl('http://localhost:3000'),
            waitForUrl('http://localhost:8888'),
        ]);
        if (!gameOk || !evalOk) throw new Error(`Servers failed to start (game=${gameOk}, eval=${evalOk})`);
        log('Both servers ready.');

        // --- Launch browsers ---
        log('Launching browsers...');
        const launchOpts = {
            headless: opts.headless,
            args: ['--no-sandbox', '--disable-setuid-sandbox',
                   '--autoplay-policy=no-user-gesture-required'],
        };
        const [b1, b2] = await Promise.all([
            puppeteer.launch(launchOpts),
            puppeteer.launch(launchOpts),
        ]);
        browsers.push(b1, b2);

        const page1 = await b1.newPage();
        const page2 = await b2.newPage();
        await page1.setViewport({ width: 800, height: 600 });
        await page2.setViewport({ width: 800, height: 600 });

        // Log errors
        for (const [label, pg] of [['P1', page1], ['P2', page2]]) {
            pg.on('pageerror', err => log(`[${label} ERROR] ${err.message}`));
        }

        // Navigate
        log('Loading game...');
        await Promise.all([
            page1.goto('http://localhost:8888', { waitUntil: 'networkidle2', timeout: 30_000 }),
            page2.goto('http://localhost:8888', { waitUntil: 'networkidle2', timeout: 30_000 }),
        ]);

        // Wait for hooks
        await Promise.all([
            page1.waitForFunction(() => window._test && window._test.hostGame, { timeout: 15_000 }),
            page2.waitForFunction(() => window._test && window._test.joinGame, { timeout: 15_000 }),
        ]);
        log('Test hooks ready.');

        // --- Capture title screen ---
        const p1TitleFrame = await captureCanvas(page1);
        const p2TitleFrame = await captureCanvas(page2);

        // --- Host and join ---
        log('P1 hosting...');
        await page1.evaluate(() => window._test.hostGame());
        let roomCode = null;
        for (let i = 0; i < 20; i++) {
            await sleep(500);
            roomCode = await page1.evaluate(() => window._test.getRoomCode());
            if (roomCode) break;
        }
        if (!roomCode) throw new Error('Room code not generated');
        log(`Room: ${roomCode}`);

        log('P2 joining...');
        await page2.evaluate((code) => window._test.joinGame(code), roomCode);
        await sleep(1500);

        // --- Ready up ---
        log('Both readying up...');
        await page1.evaluate(() => window._test.ready());
        await sleep(500);
        await page2.evaluate(() => window._test.ready());

        // Wait for MP_PLAYING (state 9)
        let started = false;
        for (let i = 0; i < 30; i++) {
            await sleep(500);
            const [s1, s2] = await Promise.all([
                page1.evaluate(() => window._test.getState()),
                page2.evaluate(() => window._test.getState()),
            ]);
            if (s1.gameState === 9 && s2.gameState === 9) { started = true; break; }
        }
        if (!started) throw new Error('Game did not start (never reached MP_PLAYING)');
        log('Game started!');

        // Click canvas for pointer lock
        for (const pg of [page1, page2]) {
            await pg.click('canvas').catch(() => {});
            await sleep(200);
        }

        // Start auto-combat
        await page1.evaluate(() => window._startAutoP1());
        await page2.evaluate(() => window._startAutoP1());
        log('Auto-combat enabled on both.');

        // --- Frame capture loop ---
        log('Capturing frames...');
        const p1Frames = [];
        const p2Frames = [];
        const matchStart = Date.now();
        let victory = false;
        let lastLog = 0;

        while (Date.now() - matchStart < MATCH_TIMEOUT_MS) {
            const captureStart = Date.now();

            // Capture both canvases in parallel
            const [f1, f2] = await Promise.all([
                captureCanvas(page1),
                captureCanvas(page2),
            ]);

            if (f1 && f2) {
                p1Frames.push(f1);
                p2Frames.push(f2);
            }

            // Check game state
            const [s1, s2] = await Promise.all([
                page1.evaluate(() => window._getMpStatus()).catch(() => null),
                page2.evaluate(() => window._getMpStatus()).catch(() => null),
            ]);

            const elapsed = ((Date.now() - matchStart) / 1000).toFixed(0);
            if (Date.now() - lastLog > 3000) {
                const t1 = s1 ? s1.localTier : '?';
                const t2 = s2 ? s2.localTier : '?';
                const p1x = s1 ? s1.playerX.toFixed(1) : '?';
                const p1y = s1 ? s1.playerY.toFixed(1) : '?';
                const p2x = s2 ? s2.playerX.toFixed(1) : '?';
                const p2y = s2 ? s2.playerY.toFixed(1) : '?';
                const p1a = s1 ? s1.playerAlive : '?';
                const p2a = s2 ? s2.playerAlive : '?';
                const p1hp = s1 ? s1.playerHP : '?';
                const p2hp = s2 ? s2.playerHP : '?';
                const auto1 = s1 ? s1.autoP1Active : '?';
                const auto2 = s2 ? s2.autoP1Active : '?';
                const err1 = s1 ? s1.loopError : null;
                const err2 = s2 ? s2.loopError : null;
                log(`${elapsed}s - ${p1Frames.length} frames | P1(${p1x},${p1y} hp=${p1hp} alive=${p1a} auto=${auto1}) tier=${t1} | P2(${p2x},${p2y} hp=${p2hp} alive=${p2a} auto=${auto2}) tier=${t2}`);
                if (err1) log(`  P1 error: ${err1}`);
                if (err2) log(`  P2 error: ${err2}`);
                lastLog = Date.now();
            }

            if ((s1 && s1.gameState === 11) || (s2 && s2.gameState === 11)) {
                victory = true;
                const winner = s1?.winnerId || s2?.winnerId;
                log(`Victory! Winner: ${winner} at ${elapsed}s`);
                // Capture a few extra victory frames
                for (let v = 0; v < 10; v++) {
                    await sleep(CAPTURE_INTERVAL_MS);
                    const [vf1, vf2] = await Promise.all([
                        captureCanvas(page1), captureCanvas(page2),
                    ]);
                    if (vf1 && vf2) { p1Frames.push(vf1); p2Frames.push(vf2); }
                }
                break;
            }

            // Maintain target framerate
            const captureElapsed = Date.now() - captureStart;
            const waitTime = Math.max(0, CAPTURE_INTERVAL_MS - captureElapsed);
            if (waitTime > 0) await sleep(waitTime);
        }

        if (!victory) log('Match timed out without victory.');
        log(`Captured ${p1Frames.length} frames total.`);

        // --- Close browsers before encoding (frees memory) ---
        await b1.close();
        await b2.close();
        browsers.length = 0;

        // --- Encode GIFs ---
        fs.mkdirSync(opts.outputDir, { recursive: true });
        const delayMs = CAPTURE_INTERVAL_MS;

        // Side-by-side GIF
        await createSideBySideGif(
            p1Frames, p2Frames,
            path.join(opts.outputDir, 'pvp-sidebyside.gif'),
            delayMs
        );

        // Individual player GIFs
        await createGif(
            p1Frames, OUT_WIDTH, OUT_HEIGHT, delayMs,
            path.join(opts.outputDir, 'pvp-player1.gif')
        );
        await createGif(
            p2Frames, OUT_WIDTH, OUT_HEIGHT, delayMs,
            path.join(opts.outputDir, 'pvp-player2.gif')
        );

        log('Done! GIFs saved to: ' + opts.outputDir);

    } catch (err) {
        log(`Error: ${err.message}`);
        log(err.stack);
        process.exit(1);
    } finally {
        await cleanup();
    }
}

main();
