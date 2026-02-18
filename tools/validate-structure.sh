#!/usr/bin/env bash
# validate-structure.sh - Validate the retro-fury project file structure
#
# Usage: ./tools/validate-structure.sh <submission-dir>
#
# Checks that all expected files and directories exist in the submission.
# Outputs JSON results for each check.

set -euo pipefail

SUBMISSION_DIR="${1:?Usage: $0 <submission-dir>}"

pass_count=0
fail_count=0
results=()

check_file() {
    local id="$1"
    local path="$2"
    local critical="${3:-false}"

    if [ -f "$SUBMISSION_DIR/$path" ]; then
        results+=("{\"check_id\": \"$id\", \"result\": \"PASS\", \"critical\": $critical, \"evidence\": \"File exists: $path\"}")
        pass_count=$((pass_count + 1))
    else
        results+=("{\"check_id\": \"$id\", \"result\": \"FAIL\", \"critical\": $critical, \"evidence\": \"Missing file: $path\"}")
        fail_count=$((fail_count + 1))
    fi
}

check_dir() {
    local id="$1"
    local path="$2"

    if [ -d "$SUBMISSION_DIR/$path" ]; then
        results+=("{\"check_id\": \"$id\", \"result\": \"PASS\", \"critical\": false, \"evidence\": \"Directory exists: $path\"}")
        pass_count=$((pass_count + 1))
    else
        results+=("{\"check_id\": \"$id\", \"result\": \"FAIL\", \"critical\": false, \"evidence\": \"Missing directory: $path\"}")
        fail_count=$((fail_count + 1))
    fi
}

echo "=== Structure Validation ==="
echo "Submission: $SUBMISSION_DIR"
echo ""

# Entry point
check_file "entry_html" "index.html" "true"
check_file "entry_css" "css/style.css" "false"

# Main
check_file "main_js" "src/main.js" "true"

# Engine
check_dir "engine_dir" "src/engine"
check_file "engine_raycaster" "src/engine/raycaster.js" "true"
check_file "engine_renderer" "src/engine/renderer.js" "false"
check_file "engine_sprite" "src/engine/sprite.js" "false"
check_file "engine_camera" "src/engine/camera.js" "false"

# Game
check_dir "game_dir" "src/game"
check_file "game_player" "src/game/player.js" "true"
check_file "game_enemy" "src/game/enemy.js" "true"
check_file "game_weapon" "src/game/weapon.js" "true"
check_file "game_projectile" "src/game/projectile.js" "false"
check_file "game_item" "src/game/item.js" "false"
check_file "game_door" "src/game/door.js" "false"
check_file "game_gun_game" "src/game/gun-game.js" "false"
check_file "game_remote_player" "src/game/remote-player.js" "false"

# Enemies
check_dir "enemies_dir" "src/game/enemies"
check_file "enemy_grunt" "src/game/enemies/grunt.js" "true"
check_file "enemy_soldier" "src/game/enemies/soldier.js" "false"
check_file "enemy_scout" "src/game/enemies/scout.js" "false"
check_file "enemy_brute" "src/game/enemies/brute.js" "false"
check_file "enemy_commander" "src/game/enemies/commander.js" "false"

# Levels
check_dir "levels_dir" "src/levels"
check_file "level_loader" "src/levels/level-loader.js" "false"
check_file "level_1" "src/levels/level1.js" "true"
check_file "level_2" "src/levels/level2.js" "false"
check_file "level_3" "src/levels/level3.js" "false"
check_file "level_4" "src/levels/level4.js" "false"
check_file "level_5" "src/levels/level5.js" "false"
check_file "level_arena" "src/levels/arena.js" "false"

# AI
check_dir "ai_dir" "src/ai"
check_file "ai_state_machine" "src/ai/state-machine.js" "true"
check_file "ai_pathfinding" "src/ai/pathfinding.js" "false"
check_file "ai_behaviors" "src/ai/behaviors.js" "false"

# UI
check_dir "ui_dir" "src/ui"
check_file "ui_hud" "src/ui/hud.js" "false"
check_file "ui_minimap" "src/ui/minimap.js" "false"
check_file "ui_menu" "src/ui/menu.js" "false"
check_file "ui_objectives" "src/ui/objectives.js" "false"
check_file "ui_transitions" "src/ui/transitions.js" "false"
check_file "ui_lobby" "src/ui/lobby.js" "false"
check_file "ui_kill_feed" "src/ui/kill-feed.js" "false"
check_file "ui_scoreboard" "src/ui/scoreboard.js" "false"

# Networking
check_dir "net_dir" "src/net"
check_file "net_manager" "src/net/network-manager.js" "false"
check_file "net_mp_state" "src/net/mp-state.js" "false"

# Audio
check_file "audio_system" "src/audio/audio.js" "false"

# Utils
check_file "utils_input" "src/utils/input.js" "false"
check_file "utils_math" "src/utils/math.js" "false"
check_file "utils_textures" "src/utils/textures.js" "false"

# Server
check_dir "server_dir" "server"
check_file "server_index" "server/index.js" "true"
check_file "server_room" "server/room.js" "false"
check_file "server_game_loop" "server/game-loop.js" "false"
check_file "server_protocol" "server/protocol.js" "false"
check_file "server_package" "server/package.json" "false"

# Output summary
echo "PASS: $pass_count"
echo "FAIL: $fail_count"
echo ""

# Output JSON
echo "{"
echo "  \"tool\": \"validate-structure\","
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
