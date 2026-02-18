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
    getRoomCode: () => lobbyScreen ? lobbyScreen._roomCode : null,
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
