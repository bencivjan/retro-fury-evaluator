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
TEST_HOOKS = """

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
// Injects synthetic input into the real input system, then delegates to the
// normal updateMultiplayer path. This avoids duplicate client-side prediction
// (which caused jitter) and ensures weapon firing works correctly.
window._autoP1Active = false;
window._autoP1Tick = 0;

const _origUpdateMP = updateMultiplayer;
updateMultiplayer = function(dt) {
    if (window._autoP1Active && gameState === GameState.MP_PLAYING && player && player.alive) {
        window._autoP1Tick++;
        const tick = window._autoP1Tick;

        const rp = mpState.remotePlayer;
        const myX = player.pos.x;
        const myY = player.pos.y;

        // Normalize player angle to prevent unbounded growth
        player.angle = ((player.angle % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;

        // --- Decide movement target ---
        // Navigate to open area when in wall corridors (walls at x=6,x=25 near y=0..3)
        const inOpenArea = myY > 6 && myX > 8 && myX < 24;
        let targetX, targetY;
        if (!inOpenArea) {
            targetX = 16; targetY = 12;
        } else if (rp && rp.alive && rp.pos) {
            targetX = rp.pos.x; targetY = rp.pos.y;
        } else {
            targetX = 16 + Math.sin(tick * 0.01) * 5;
            targetY = 16 + Math.cos(tick * 0.01) * 5;
        }

        // --- Compute aim ---
        const targetAngle = Math.atan2(targetY - myY, targetX - myX);
        let angleDiff = targetAngle - player.angle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        // Clamp mouseDX to avoid extreme per-frame rotation
        const mouseDX = Math.max(-150, Math.min(150, angleDiff / 0.003));

        // --- Decide firing ---
        let shouldFire = false;
        if (rp && rp.alive && rp.pos) {
            const rpDist = Math.sqrt(Math.pow(rp.pos.x - myX, 2) + Math.pow(rp.pos.y - myY, 2));
            const rpAngle = Math.atan2(rp.pos.y - myY, rp.pos.x - myX);
            let rpDiff = rpAngle - player.angle;
            while (rpDiff > Math.PI) rpDiff -= 2 * Math.PI;
            while (rpDiff < -Math.PI) rpDiff += 2 * Math.PI;
            shouldFire = Math.abs(rpDiff) < 0.44 && rpDist < 20;
        }

        // --- Inject into real input system (private fields) ---
        // This lets the normal player.update() and weaponSystem.update() work
        // through their standard code paths, avoiding duplicate prediction.
        input._keysDown.clear();
        input._keysDown.add('KeyW');
        const strafePhase = tick % 80;
        if (strafePhase < 20) input._keysDown.add('KeyA');
        else if (strafePhase >= 40 && strafePhase < 60) input._keysDown.add('KeyD');

        input._mouseDeltaX = mouseDX;
        input._mouseDeltaY = 0;
        input._mouseDown = shouldFire;
        input._mousePressed = shouldFire;
    }

    // Run the normal updateMultiplayer (handles input send, prediction,
    // weapon animation, mpState, camera sync — all in one consistent path)
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
                content += TEST_HOOKS.encode("utf-8")
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
