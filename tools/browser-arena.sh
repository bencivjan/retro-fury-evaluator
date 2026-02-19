#!/usr/bin/env bash
# browser-arena.sh - Wrapper for browser-arena.js
#
# Usage: ./tools/browser-arena.sh [submission-id] [options]
#
# Ensures puppeteer is installed, then runs the Puppeteer-based
# multiplayer arena test. Forwards all arguments to browser-arena.js.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Ensure puppeteer is installed
if [ ! -d "$REPO_ROOT/node_modules/puppeteer" ]; then
    echo "[browser-arena.sh] Installing puppeteer..."
    (cd "$REPO_ROOT" && npm install --silent)
fi

exec node "$SCRIPT_DIR/browser-arena.js" "$@"
