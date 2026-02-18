#!/usr/bin/env python3
"""Test server for evaluation - serves game files with injected test hooks.

Serves the submission directory on port 8888. When main.js is requested,
appends window-level test bindings so the evaluator can skip between levels
and inspect game state from the browser console.

This does NOT modify any files on disk.
"""

import http.server
import os
import sys

SUBMISSION_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "submissions",
)

# JavaScript to append to main.js - exposes test hooks on window
TEST_HOOKS = b"""

// === EVALUATOR TEST HOOKS (injected by eval-server.py) ===
window._test = {
    loadLevel: (idx) => { loadLevel(idx); gameState = GameState.LEVEL_INTRO; introCharIndex = 0; },
    skipToPlaying: () => { gameState = GameState.PLAYING; },
    getState: () => ({
        gameState, currentLevelIndex,
        playerHP: player ? player.health : null,
        hasPlayer: !!player,
        hasMpMap: !!mpMap,
        hasMpPalette: typeof mpPalette !== 'undefined' && !!mpPalette,
        loopError: window._loopError || null,
    }),
    GameState,
    // Multiplayer hooks
    goToLobby: () => { gameState = GameState.LOBBY; },
    hostGame: async () => {
        gameState = GameState.LOBBY;
        await networkManager.connect();
        setupNetworkHandlers();
        networkManager.send({ type: 'create_room' });
    },
    joinGame: async (roomCode) => {
        gameState = GameState.LOBBY;
        if (!networkManager.isConnected()) {
            await networkManager.connect();
            setupNetworkHandlers();
        }
        networkManager.send({ type: 'join_room', roomCode });
    },
    ready: () => { networkManager.send({ type: 'ready' }); },
    getLobbyState: () => lobbyScreen ? lobbyScreen.state : null,
    getRoomCode: () => lobbyScreen ? lobbyScreen.roomCode : null,
    isPointerLocked: () => input.isPointerLocked(),
    restartLoop: () => { requestAnimationFrame(gameLoop); },
    getCanvasData: () => document.getElementById('game-canvas').toDataURL('image/png'),
};

// Patch: fix HUD crash in multiplayer (state.label undefined)
// The renderMultiplayer passes {objectives:[], tabHeld:false} but
// _renderObjectiveCounter expects {label, current, total}
const _origRenderMP = renderMultiplayer;
renderMultiplayer = function(dt) {
    // Temporarily override hud.render to pass null objectiveState for MP
    const origHudRender = hud.render.bind(hud);
    hud.render = function(ctx, player, ws, objState, dt) {
        // Pass null to skip _renderObjectiveCounter in MP mode
        origHudRender(ctx, player, ws, null, dt);
    };
    try {
        _origRenderMP(dt);
    } finally {
        hud.render = origHudRender;
    }
};

// Wrap game loop with error catching
const _origGameLoop = gameLoop;
gameLoop = function(timestamp) {
    try {
        _origGameLoop(timestamp);
    } catch(e) {
        window._loopError = e.message + ' | ' + e.stack;
        console.error('Game loop error:', e);
        // Blit buffer to display despite error
        try {
            const display = document.getElementById('game-canvas');
            const displayCtx = display.getContext('2d');
            const buffer = document.createElement('canvas');
            displayCtx.drawImage(buffer, 0, 0);
        } catch(_) {}
        // Restart the loop despite error
        requestAnimationFrame(gameLoop);
    }
};

// === AUTO-COMBAT for P1 (bypasses pointer lock requirement) ===
// Patches updateMultiplayer to use auto-combat input instead of real input.
window._autoP1Active = false;
window._autoP1Tick = 0;

// Store the desired auto-combat input per frame
window._autoP1Input = { keys: [], mouseDX: 0, fire: false };

// Patch updateMultiplayer to use auto-combat input when active
const _origUpdateMP = updateMultiplayer;
updateMultiplayer = function(dt) {
    if (window._autoP1Active && gameState === GameState.MP_PLAYING && player && player.alive) {
        window._autoP1Tick++;
        const tick = window._autoP1Tick;

        const rp = mpState.remotePlayer;
        let keys = [];
        let mouseDX = 0;
        let shouldFire = false;

        const myX = player.pos.x;
        const myY = player.pos.y;

        // Normalize player angle to prevent unbounded growth
        player.angle = ((player.angle % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

        // Phase 1: Navigate to open area when in wall corridors.
        // Map has wall columns at x=6 and x=25 from y=0 to y=3.
        const inOpenArea = myY > 6 && myX > 8 && myX < 24;
        const navPhase = !inOpenArea;

        let targetX, targetY;
        if (navPhase) {
            targetX = 16;
            targetY = 12;
        } else if (rp && rp.alive && rp.pos) {
            targetX = rp.pos.x;
            targetY = rp.pos.y;
        } else {
            targetX = 16 + Math.sin(tick * 0.01) * 5;
            targetY = 16 + Math.cos(tick * 0.01) * 5;
        }

        const dx = targetX - myX;
        const dy = targetY - myY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const targetAngle = Math.atan2(dy, dx);
        let angleDiff = targetAngle - player.angle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        mouseDX = Math.max(-300, Math.min(300, angleDiff / 0.003));

        keys.push('KeyW');
        const strafePhase = tick % 80;
        if (strafePhase < 20) keys.push('KeyA');
        else if (strafePhase >= 40 && strafePhase < 60) keys.push('KeyD');

        // Fire whenever aimed at opponent, even during nav
        if (rp && rp.alive) {
            const rpDist = Math.sqrt(Math.pow(rp.pos.x - myX, 2) + Math.pow(rp.pos.y - myY, 2));
            const rpAngle = Math.atan2(rp.pos.y - myY, rp.pos.x - myX);
            let rpDiff = rpAngle - player.angle;
            while (rpDiff > Math.PI) rpDiff -= 2 * Math.PI;
            while (rpDiff < -Math.PI) rpDiff += 2 * Math.PI;
            shouldFire = Math.abs(rpDiff) < 0.44 && rpDist < 20;
        }

        // Send input to server (replaces the normal input send)
        networkManager.send({
            type: 'input',
            keys,
            mouseDX,
            mouseDY: 0,
            fire: shouldFire,
            dt,
        });

        // Still do client-side prediction and animation but skip normal input send
        if (player && player.alive && mpMap) {
            // Manually apply movement for local prediction
            const cos = Math.cos(player.angle);
            const sin = Math.sin(player.angle);
            if (keys.includes('KeyW')) {
                player.pos.x += cos * 3.0 * dt;
                player.pos.y += sin * 3.0 * dt;
            }
            player.angle += mouseDX * 0.003;
        }

        // Update weapon animation, mp state, camera sync
        const mpFireResult = weaponSystem.update(dt, input, player, [], mpMap || { grid: [], width: 0, height: 0 });
        if (mpFireResult) {
            const mpSoundMap = { 0: 'pistol_fire', 1: 'shotgun_fire', 2: 'machinegun_fire', 5: 'sniper_fire', 6: 'knife_swing' };
            const soundName = mpSoundMap[weaponSystem.currentWeapon];
            if (soundName) audio.play(soundName);
        }
        mpState.update(dt);
        killFeed.update(dt);
        scoreboard.setTiers(mpState.localTier, mpState.remoteTier);
        if (player && player.alive) syncCamera();
        return;
    }

    // Normal path when auto-combat is off
    _origUpdateMP(dt);
};

window._startAutoP1 = () => {
    window._autoP1Active = true;
    window._autoP1Tick = 0;
    console.log('[AutoP1] Started - overriding updateMultiplayer input');
};

window._stopAutoP1 = () => {
    window._autoP1Active = false;
    console.log('[AutoP1] Stopped');
};

// Extended getState for capture script monitoring
window._getMpStatus = () => {
    const rp = mpState ? mpState.remotePlayer : null;
    return {
        gameState,
        localTier: mpState ? mpState.localTier : -1,
        remoteTier: mpState ? mpState.remoteTier : -1,
        winnerId: mpState ? mpState.winnerId : null,
        localId: mpState ? mpState.localPlayerId : null,
        matchTime: mpState ? mpState.matchTime : 0,
        playerAlive: player ? player.alive : false,
        playerHP: player ? player.health : 0,
        playerX: player ? player.pos.x : 0,
        playerY: player ? player.pos.y : 0,
        playerAngle: player ? player.angle : 0,
        remoteAlive: rp ? rp.alive : false,
        remoteX: rp ? rp.pos.x : 0,
        remoteY: rp ? rp.pos.y : 0,
        autoP1Active: window._autoP1Active,
        autoP1Tick: window._autoP1Tick || 0,
        loopError: window._loopError || null,
    };
};
"""


class EvalHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=self.submission_dir, **kwargs)

    def do_GET(self):
        # Intercept main.js to append test hooks
        if self.path == "/src/main.js":
            filepath = os.path.join(self.submission_dir, "src", "main.js")
            try:
                with open(filepath, "rb") as f:
                    content = f.read()
                content += TEST_HOOKS
                self.send_response(200)
                self.send_header("Content-Type", "application/javascript")
                self.send_header("Content-Length", len(content))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content)
            except FileNotFoundError:
                self.send_error(404)
            return
        super().do_GET()


def main():
    if len(sys.argv) > 1:
        submission_id = sys.argv[1]
    else:
        # Use most recent submission
        subs = sorted(
            [d for d in os.listdir(SUBMISSION_DIR) if d != ".gitkeep"],
            reverse=True,
        )
        if not subs:
            print("No submissions found")
            sys.exit(1)
        submission_id = subs[0]

    EvalHandler.submission_dir = os.path.join(SUBMISSION_DIR, submission_id)
    print(f"Serving submission: {submission_id}")
    print(f"Directory: {EvalHandler.submission_dir}")
    print(f"Test hooks injected into main.js")

    port = 8888
    server = http.server.HTTPServer(("0.0.0.0", port), EvalHandler)
    print(f"Listening on http://0.0.0.0:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
