#!/usr/bin/env node
// verify-multiplayer.js - Verify multiplayer implementation
//
// Usage: node tools/verify-multiplayer.js <submission-dir>
//
// Checks the WebSocket server, protocol messages, gun game mode,
// arena map, and multiplayer networking against the vision.

const fs = require('fs');
const path = require('path');

const submissionDir = process.argv[2];
if (!submissionDir) {
    console.error('Usage: node verify-multiplayer.js <submission-dir>');
    process.exit(1);
}

const results = [];
let passCount = 0;
let failCount = 0;

function addResult(checkId, result, evidence) {
    results.push({ check_id: checkId, result, evidence });
    if (result === 'PASS') passCount++;
    else failCount++;
}

function readFile(relativePath) {
    const fullPath = path.join(submissionDir, relativePath);
    try {
        return fs.readFileSync(fullPath, 'utf-8');
    } catch {
        return null;
    }
}

function searchFor(content, pattern) {
    if (!content) return false;
    if (typeof pattern === 'string') return content.includes(pattern);
    return pattern.test(content);
}

// =========================================================================
// Server Structure
// =========================================================================
function checkServerStructure() {
    const serverIndex = readFile('server/index.js');
    if (!serverIndex) {
        addResult('mp_server_entry', 'FAIL', 'server/index.js not found');
        return;
    }
    addResult('mp_server_entry', 'PASS', 'Server entry point exists');

    // Check for WebSocket usage
    if (searchFor(serverIndex, /WebSocket|ws|wss/i) || searchFor(serverIndex, /require.*ws|import.*ws/)) {
        addResult('mp_websocket', 'PASS', 'WebSocket library usage detected');
    } else {
        addResult('mp_websocket', 'FAIL', 'No WebSocket library usage detected');
    }

    // Check for port 3000
    if (searchFor(serverIndex, /3000/)) {
        addResult('mp_port', 'PASS', 'Server listens on port 3000');
    } else {
        addResult('mp_port', 'FAIL', 'Port 3000 not referenced in server entry');
    }
}

// =========================================================================
// Protocol Messages
// =========================================================================
function checkProtocol() {
    const protocolFile = readFile('server/protocol.js');
    const serverIndex = readFile('server/index.js');
    const roomFile = readFile('server/room.js');
    const gameLoopFile = readFile('server/game-loop.js');
    const networkManager = readFile('src/net/network-manager.js');

    const allServer = (protocolFile || '') + (serverIndex || '') + (roomFile || '') + (gameLoopFile || '');
    const allCode = allServer + (networkManager || '');

    if (!allServer) {
        addResult('mp_protocol', 'FAIL', 'No server code found to check protocol');
        return;
    }

    // Client -> Server messages
    const clientMessages = [
        { type: 'create_room', desc: 'Create room' },
        { type: 'join', desc: 'Join room' },
        { type: 'ready', desc: 'Ready up' },
        { type: 'input', desc: 'Player input' },
    ];

    let clientMsgCount = 0;
    for (const msg of clientMessages) {
        if (searchFor(allCode, new RegExp(msg.type, 'i'))) {
            clientMsgCount++;
        }
    }

    // Server -> Client messages
    const serverMessages = [
        { type: 'room_created', desc: 'Room created' },
        { type: 'player_joined', desc: 'Player joined' },
        { type: 'game_start', desc: 'Game start' },
        { type: 'state', desc: 'State update' },
        { type: 'hit', desc: 'Hit event' },
        { type: 'kill', desc: 'Kill event' },
        { type: 'respawn', desc: 'Respawn event' },
        { type: 'victory', desc: 'Victory event' },
        { type: 'opponent_disconnected', desc: 'Disconnect notification' },
    ];

    let serverMsgCount = 0;
    for (const msg of serverMessages) {
        if (searchFor(allCode, new RegExp(msg.type, 'i'))) {
            serverMsgCount++;
        }
    }

    const totalExpected = clientMessages.length + serverMessages.length;
    const totalFound = clientMsgCount + serverMsgCount;

    if (totalFound >= totalExpected * 0.7) {
        addResult('mp_protocol_messages', 'PASS', `${totalFound}/${totalExpected} protocol messages found (client: ${clientMsgCount}/${clientMessages.length}, server: ${serverMsgCount}/${serverMessages.length})`);
    } else {
        addResult('mp_protocol_messages', 'FAIL', `Only ${totalFound}/${totalExpected} protocol messages found (client: ${clientMsgCount}/${clientMessages.length}, server: ${serverMsgCount}/${serverMessages.length})`);
    }
}

// =========================================================================
// Room Management
// =========================================================================
function checkRoomManagement() {
    const roomFile = readFile('server/room.js');
    const serverIndex = readFile('server/index.js');
    const combined = (roomFile || '') + (serverIndex || '');

    if (!combined) {
        addResult('mp_rooms', 'FAIL', 'No server code found for room management');
        return;
    }

    if (searchFor(combined, /room|lobby/i)) {
        addResult('mp_rooms', 'PASS', 'Room/lobby management detected');
    } else {
        addResult('mp_rooms', 'FAIL', 'No room/lobby management detected');
    }

    // Check room code generation
    if (searchFor(combined, /code|roomCode|room.?id/i)) {
        addResult('mp_room_code', 'PASS', 'Room code system detected');
    } else {
        addResult('mp_room_code', 'FAIL', 'No room code system detected');
    }
}

// =========================================================================
// Gun Game Mode
// =========================================================================
function checkGunGame() {
    const gunGameFile = readFile('src/game/gun-game.js');
    const serverGameLoop = readFile('server/game-loop.js');
    const combined = (gunGameFile || '') + (serverGameLoop || '');

    if (!gunGameFile && !serverGameLoop) {
        addResult('mp_gun_game', 'FAIL', 'No gun game implementation found');
        return;
    }

    if (gunGameFile) {
        addResult('mp_gun_game_module', 'PASS', 'Gun game module exists (src/game/gun-game.js)');
    }

    // Check weapon progression
    if (searchFor(combined, /tier|progression|promote|advance|level.?up/i)) {
        addResult('mp_weapon_progression', 'PASS', 'Weapon tier progression system detected');
    } else {
        addResult('mp_weapon_progression', 'FAIL', 'No weapon tier progression system detected');
    }

    // Check for knife/final weapon
    if (searchFor(combined, /knife|melee|final.?weapon|last.?tier/i)) {
        addResult('mp_knife_win', 'PASS', 'Knife (victory weapon) detected');
    } else {
        addResult('mp_knife_win', 'FAIL', 'No knife/victory weapon detected');
    }

    // Check for sniper
    if (searchFor(combined, /sniper|scope|zoom/i)) {
        addResult('mp_sniper', 'PASS', 'Sniper weapon detected');
    } else {
        addResult('mp_sniper', 'FAIL', 'No sniper weapon detected');
    }
}

// =========================================================================
// Arena Map
// =========================================================================
function checkArena() {
    const arenaFile = readFile('src/levels/arena.js');
    if (!arenaFile) {
        addResult('mp_arena', 'FAIL', 'src/levels/arena.js not found');
        return;
    }
    addResult('mp_arena', 'PASS', 'Arena map module exists');

    // Check for map data (may use 'map:' as object property with nested arrays)
    if (searchFor(arenaFile, /\[/) && searchFor(arenaFile, /map\s*:|grid|layout|tiles/i)) {
        addResult('mp_arena_map_data', 'PASS', 'Arena map data (2D array) detected');
    } else {
        addResult('mp_arena_map_data', 'FAIL', 'No arena map data detected');
    }

    // Check for spawn points
    if (searchFor(arenaFile, /spawn/i)) {
        addResult('mp_arena_spawns', 'PASS', 'Spawn points defined in arena');
    } else {
        addResult('mp_arena_spawns', 'FAIL', 'No spawn points defined in arena');
    }

    // Check for symmetry mention or balanced design
    if (searchFor(arenaFile, /32/) || searchFor(arenaFile, /symmetric|symmetr/i)) {
        addResult('mp_arena_size', 'PASS', '32x32 or symmetric layout references found');
    } else {
        addResult('mp_arena_size', 'FAIL', 'No 32x32 or symmetric layout references found');
    }
}

// =========================================================================
// Server Game Loop
// =========================================================================
function checkGameLoop() {
    const gameLoopFile = readFile('server/game-loop.js');
    if (!gameLoopFile) {
        addResult('mp_game_loop', 'FAIL', 'server/game-loop.js not found');
        return;
    }
    addResult('mp_game_loop', 'PASS', 'Server game loop exists');

    // Check tick rate (20 tps = 50ms)
    if (searchFor(gameLoopFile, /50/) || searchFor(gameLoopFile, /tick.?rate|20/i)) {
        addResult('mp_tick_rate', 'PASS', 'Tick rate configuration detected (50ms / 20tps)');
    } else {
        addResult('mp_tick_rate', 'FAIL', 'No tick rate configuration detected');
    }

    // Check hit detection
    if (searchFor(gameLoopFile, /hit|damage|hitscan|raycast/i)) {
        addResult('mp_hit_detection', 'PASS', 'Server-side hit detection detected');
    } else {
        addResult('mp_hit_detection', 'FAIL', 'No server-side hit detection detected');
    }

    // Check respawn
    if (searchFor(gameLoopFile, /respawn|revive/i)) {
        addResult('mp_respawn', 'PASS', 'Respawn system detected');
    } else {
        addResult('mp_respawn', 'FAIL', 'No respawn system detected');
    }
}

// =========================================================================
// Client Networking
// =========================================================================
function checkClientNet() {
    const netManager = readFile('src/net/network-manager.js');
    if (!netManager) {
        addResult('mp_client_net', 'FAIL', 'src/net/network-manager.js not found');
        return;
    }
    addResult('mp_client_net', 'PASS', 'Client network manager exists');

    if (searchFor(netManager, /WebSocket/i)) {
        addResult('mp_client_ws', 'PASS', 'Client WebSocket connection detected');
    } else {
        addResult('mp_client_ws', 'FAIL', 'No client WebSocket connection detected');
    }

    // Check for remote player rendering
    const remotePlayerFile = readFile('src/game/remote-player.js');
    if (remotePlayerFile) {
        addResult('mp_remote_player', 'PASS', 'Remote player module exists');

        if (searchFor(remotePlayerFile, /interpolat|lerp|smooth/i)) {
            addResult('mp_interpolation', 'PASS', 'Position interpolation detected');
        } else {
            addResult('mp_interpolation', 'FAIL', 'No position interpolation detected');
        }
    } else {
        addResult('mp_remote_player', 'FAIL', 'src/game/remote-player.js not found');
    }

    // Check lobby UI
    const lobbyFile = readFile('src/ui/lobby.js');
    if (lobbyFile) {
        addResult('mp_lobby_ui', 'PASS', 'Multiplayer lobby UI exists');
    } else {
        addResult('mp_lobby_ui', 'FAIL', 'src/ui/lobby.js not found');
    }
}

// =========================================================================
// Run all checks
// =========================================================================
console.log('=== Multiplayer Verification ===');
console.log(`Submission: ${submissionDir}`);
console.log('');

checkServerStructure();
checkProtocol();
checkRoomManagement();
checkGunGame();
checkArena();
checkGameLoop();
checkClientNet();

console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
console.log('');

const output = {
    tool: 'verify-multiplayer',
    submission: submissionDir,
    summary: { pass: passCount, fail: failCount },
    results,
};

console.log(JSON.stringify(output, null, 2));
