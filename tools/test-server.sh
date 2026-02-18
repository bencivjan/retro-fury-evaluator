#!/usr/bin/env bash
# test-server.sh - Test the WebSocket multiplayer server
#
# Usage: ./tools/test-server.sh <submission-dir>
#
# Starts the server, validates it accepts connections, then shuts it down.

set -euo pipefail

SUBMISSION_DIR="${1:?Usage: $0 <submission-dir>}"
SERVER_DIR="$SUBMISSION_DIR/server"

results=()
pass_count=0
fail_count=0

add_result() {
    local id="$1" result="$2" evidence="$3"
    results+=("{\"check_id\": \"$id\", \"result\": \"$result\", \"evidence\": \"$evidence\"}")
    if [ "$result" = "PASS" ]; then pass_count=$((pass_count + 1)); else fail_count=$((fail_count + 1)); fi
}

cleanup() {
    if [ -n "${SERVER_PID:-}" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

echo "=== Server Tests ==="
echo "Submission: $SUBMISSION_DIR"
echo ""

# Check server directory exists
if [ ! -d "$SERVER_DIR" ]; then
    add_result "server_dir" "FAIL" "No server/ directory found"
    echo "PASS: $pass_count"
    echo "FAIL: $fail_count"
    echo "{\"tool\": \"test-server\", \"summary\": {\"pass\": $pass_count, \"fail\": $fail_count}, \"results\": [${results[0]}]}"
    exit 0
fi

# Check package.json
if [ -f "$SERVER_DIR/package.json" ]; then
    add_result "server_package" "PASS" "package.json exists"

    # Check ws dependency
    if grep -q '"ws"' "$SERVER_DIR/package.json"; then
        add_result "server_ws_dep" "PASS" "ws dependency declared in package.json"
    else
        add_result "server_ws_dep" "FAIL" "ws dependency not found in package.json"
    fi
else
    add_result "server_package" "FAIL" "No package.json in server/"
    add_result "server_ws_dep" "FAIL" "Cannot check ws dependency without package.json"
fi

# Check index.js exists
if [ ! -f "$SERVER_DIR/index.js" ]; then
    add_result "server_entry" "FAIL" "No index.js in server/"
else
    add_result "server_entry" "PASS" "server/index.js exists"
fi

# Install dependencies and start server
if [ -f "$SERVER_DIR/package.json" ]; then
    cd "$SERVER_DIR"

    if [ ! -d "node_modules" ]; then
        npm install --silent 2>/dev/null || true
    fi

    if [ -f "index.js" ]; then
        # Start server in background
        node index.js &
        SERVER_PID=$!

        # Wait for server to start (up to 5 seconds)
        server_ready=false
        for i in $(seq 1 10); do
            sleep 0.5
            if curl -s -o /dev/null -w '' "http://localhost:3000" 2>/dev/null; then
                server_ready=true
                break
            fi
            # Check if process is still running
            if ! kill -0 "$SERVER_PID" 2>/dev/null; then
                break
            fi
        done

        if [ "$server_ready" = true ]; then
            add_result "server_starts" "PASS" "Server started and listening on port 3000"

            # Test WebSocket connection using Node.js
            ws_test=$(node -e "
                const WebSocket = require('ws');
                const ws = new WebSocket('ws://localhost:3000');
                ws.on('open', () => {
                    console.log('connected');
                    ws.close();
                    process.exit(0);
                });
                ws.on('error', (e) => {
                    console.log('error: ' + e.message);
                    process.exit(1);
                });
                setTimeout(() => {
                    console.log('timeout');
                    process.exit(1);
                }, 3000);
            " 2>&1 || echo "error")

            if [ "$ws_test" = "connected" ]; then
                add_result "server_ws_connect" "PASS" "WebSocket connection established successfully"
            else
                add_result "server_ws_connect" "FAIL" "WebSocket connection failed: $ws_test"
            fi
        else
            add_result "server_starts" "FAIL" "Server failed to start within 5 seconds"
            add_result "server_ws_connect" "FAIL" "Cannot test WebSocket (server not running)"
        fi
    fi

    cd - > /dev/null
fi

echo "PASS: $pass_count"
echo "FAIL: $fail_count"
echo ""

# Output JSON
echo "{"
echo "  \"tool\": \"test-server\","
echo "  \"submission\": \"$SUBMISSION_DIR\","
echo "  \"summary\": {\"pass\": $pass_count, \"fail\": $fail_count},"
echo "  \"results\": ["

for i in "${!results[@]}"; do
    if [ $i -eq $((${#results[@]} - 1)) ]; then
        echo "    ${results[$i]}"
    else
        echo "    ${results[$i]},"
    fi
done

echo "  ]"
echo "}"
