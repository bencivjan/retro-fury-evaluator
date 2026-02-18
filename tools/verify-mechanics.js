#!/usr/bin/env node
// verify-mechanics.js - Verify game mechanics match the vision spec
//
// Usage: node tools/verify-mechanics.js <submission-dir>
//
// Reads game source files and checks weapon stats, enemy stats, level configs,
// AI state machine, and other mechanical properties against the vision.

const fs = require('fs');
const path = require('path');

const submissionDir = process.argv[2];
if (!submissionDir) {
    console.error('Usage: node verify-mechanics.js <submission-dir>');
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

function searchFor(content, pattern, description) {
    if (!content) return false;
    if (typeof pattern === 'string') return content.includes(pattern);
    return pattern.test(content);
}

// =========================================================================
// Weapon Checks
// =========================================================================
function checkWeapons() {
    const weaponFile = readFile('src/game/weapon.js');
    const mainFile = readFile('src/main.js');
    const combined = (weaponFile || '') + (mainFile || '');

    if (!weaponFile) {
        addResult('weapons_file', 'FAIL', 'src/game/weapon.js not found');
        return;
    }
    addResult('weapons_file', 'PASS', 'src/game/weapon.js exists');

    // Check each weapon exists
    const weapons = ['pistol', 'shotgun', 'machine.?gun', 'rocket', 'plasma'];
    const weaponNames = ['Pistol', 'Shotgun', 'Machine Gun', 'Rocket Launcher', 'Plasma Rifle'];

    let weaponCount = 0;
    for (let i = 0; i < weapons.length; i++) {
        const regex = new RegExp(weapons[i], 'i');
        if (searchFor(combined, regex)) {
            weaponCount++;
        }
    }

    if (weaponCount >= 5) {
        addResult('weapons_all_five', 'PASS', `All 5 weapons found (${weaponCount} detected)`);
    } else {
        addResult('weapons_all_five', 'FAIL', `Only ${weaponCount}/5 weapons detected`);
    }

    // Check for hitscan vs projectile distinction
    if (searchFor(combined, /hitscan|hit.?scan/i)) {
        addResult('weapons_hitscan', 'PASS', 'Hitscan weapon type detected');
    } else {
        addResult('weapons_hitscan', 'FAIL', 'No hitscan weapon type detected');
    }

    // Check for projectile weapons
    const projectileFile = readFile('src/game/projectile.js');
    if (projectileFile || searchFor(combined, /projectile|rocket|splash/i)) {
        addResult('weapons_projectile', 'PASS', 'Projectile weapon system detected');
    } else {
        addResult('weapons_projectile', 'FAIL', 'No projectile weapon system detected');
    }

    // Check weapon switching (1-5 keys)
    const inputFile = readFile('src/utils/input.js');
    const allFiles = combined + (inputFile || '');
    if (searchFor(allFiles, /weapon.*(switch|select|change)|key.*[1-5]|Digit[1-5]/i)) {
        addResult('weapons_switching', 'PASS', 'Weapon switching mechanism detected');
    } else {
        addResult('weapons_switching', 'FAIL', 'No weapon switching mechanism detected');
    }
}

// =========================================================================
// Enemy Checks
// =========================================================================
function checkEnemies() {
    const enemyFile = readFile('src/game/enemy.js');
    if (!enemyFile) {
        addResult('enemies_base', 'FAIL', 'src/game/enemy.js not found');
        return;
    }
    addResult('enemies_base', 'PASS', 'src/game/enemy.js exists');

    const enemyTypes = [
        { name: 'grunt', file: 'src/game/enemies/grunt.js', hp: 30 },
        { name: 'soldier', file: 'src/game/enemies/soldier.js', hp: 50 },
        { name: 'scout', file: 'src/game/enemies/scout.js', hp: 25 },
        { name: 'brute', file: 'src/game/enemies/brute.js', hp: 150 },
        { name: 'commander', file: 'src/game/enemies/commander.js', hp: 500 },
    ];

    // HP values may be in individual enemy files OR in the shared behaviors config
    const behaviorsFile = readFile('src/ai/behaviors.js');

    let enemyCount = 0;
    for (const enemy of enemyTypes) {
        const content = readFile(enemy.file);
        if (content) {
            enemyCount++;

            // Check HP value in the enemy file itself first, then in behaviors.js
            const filesToCheck = [content, behaviorsFile || '', enemyFile || ''];
            const combined = filesToCheck.join('\n');

            // Look for HP near the enemy type name in behaviors.js
            let hpFound = false;
            if (behaviorsFile) {
                // Find the behavior block for this enemy type
                const nameUpper = enemy.name.toUpperCase();
                const behaviorRegex = new RegExp(`${nameUpper}[\\s\\S]*?hp\\s*:\\s*(\\d+)`, 'i');
                const behaviorMatch = behaviorsFile.match(behaviorRegex);
                if (behaviorMatch && parseInt(behaviorMatch[1]) === enemy.hp) {
                    addResult(`enemy_${enemy.name}_hp`, 'PASS', `${enemy.name} HP = ${enemy.hp} (found in behaviors.js, matches spec)`);
                    hpFound = true;
                } else if (behaviorMatch) {
                    addResult(`enemy_${enemy.name}_hp`, 'FAIL', `${enemy.name} HP = ${behaviorMatch[1]} in behaviors.js (expected ${enemy.hp})`);
                    hpFound = true;
                }
            }

            if (!hpFound) {
                // Fall back to checking the individual enemy file
                const hpMatch = content.match(/(?:hp|health|hitpoints)\s*[:=]\s*(\d+)/i);
                if (hpMatch && parseInt(hpMatch[1]) === enemy.hp) {
                    addResult(`enemy_${enemy.name}_hp`, 'PASS', `${enemy.name} HP = ${enemy.hp} (matches spec)`);
                } else if (hpMatch) {
                    addResult(`enemy_${enemy.name}_hp`, 'FAIL', `${enemy.name} HP = ${hpMatch[1]} (expected ${enemy.hp})`);
                } else {
                    addResult(`enemy_${enemy.name}_hp`, 'FAIL', `${enemy.name} HP value not found in ${enemy.file} or behaviors.js`);
                }
            }
        } else {
            addResult(`enemy_${enemy.name}_file`, 'FAIL', `Missing ${enemy.file}`);
        }
    }

    if (enemyCount >= 5) {
        addResult('enemies_all_five', 'PASS', `All 5 enemy types found (${enemyCount})`);
    } else {
        addResult('enemies_all_five', 'FAIL', `Only ${enemyCount}/5 enemy types found`);
    }

    // Check Commander boss phases
    const commanderFile = readFile('src/game/enemies/commander.js');
    if (commanderFile) {
        const hasPhases = searchFor(commanderFile, /phase/i);
        const hasMissile = searchFor(commanderFile, /missile|rocket|barrage/i);
        const hasCharge = searchFor(commanderFile, /charge|rush/i);
        const hasRage = searchFor(commanderFile, /rage|enrage/i);

        if (hasPhases && (hasMissile || hasCharge || hasRage)) {
            addResult('enemy_commander_phases', 'PASS', `Commander has phase-based behavior (phases: ${hasPhases}, missile: ${hasMissile}, charge: ${hasCharge}, rage: ${hasRage})`);
        } else {
            addResult('enemy_commander_phases', 'FAIL', 'Commander boss missing phase-based attack patterns');
        }
    }
}

// =========================================================================
// AI System Checks
// =========================================================================
function checkAI() {
    const stateMachineFile = readFile('src/ai/state-machine.js');
    if (!stateMachineFile) {
        addResult('ai_state_machine', 'FAIL', 'src/ai/state-machine.js not found');
        return;
    }
    addResult('ai_state_machine', 'PASS', 'State machine module exists');

    // Check for required states
    // DEATH may be called DYING or DEAD in implementation
    const requiredStates = ['IDLE', 'PATROL', 'ALERT', 'CHASE', 'ATTACK', 'PAIN', 'DEATH|DYING|DEAD'];
    const foundStates = [];
    const missingStates = [];

    for (const state of requiredStates) {
        if (searchFor(stateMachineFile, new RegExp(state, 'i'))) {
            foundStates.push(state);
        } else {
            missingStates.push(state);
        }
    }

    if (missingStates.length === 0) {
        addResult('ai_all_states', 'PASS', `All ${requiredStates.length} states found: ${foundStates.join(', ')}`);
    } else {
        addResult('ai_all_states', 'FAIL', `Missing states: ${missingStates.join(', ')}. Found: ${foundStates.join(', ')}`);
    }

    // Check pathfinding
    const pathfindingFile = readFile('src/ai/pathfinding.js');
    if (pathfindingFile) {
        addResult('ai_pathfinding', 'PASS', 'Pathfinding module exists');
    } else {
        addResult('ai_pathfinding', 'FAIL', 'src/ai/pathfinding.js not found');
    }

    // Check behaviors
    const behaviorsFile = readFile('src/ai/behaviors.js');
    if (behaviorsFile) {
        addResult('ai_behaviors', 'PASS', 'Behaviors module exists');
    } else {
        addResult('ai_behaviors', 'FAIL', 'src/ai/behaviors.js not found');
    }

    // Check line-of-sight
    const allAI = (stateMachineFile || '') + (pathfindingFile || '') + (behaviorsFile || '');
    if (searchFor(allAI, /line.?of.?sight|los|ray.?cast|visibility/i)) {
        addResult('ai_line_of_sight', 'PASS', 'Line-of-sight detection mechanism found');
    } else {
        addResult('ai_line_of_sight', 'FAIL', 'No line-of-sight detection mechanism found');
    }

    // Check sound alerting
    if (searchFor(allAI, /alert|hear|sound|noise|gunshot/i)) {
        addResult('ai_alerting', 'PASS', 'Sound-based alerting mechanism found');
    } else {
        addResult('ai_alerting', 'FAIL', 'No sound-based alerting mechanism found');
    }
}

// =========================================================================
// Level Checks
// =========================================================================
function checkLevels() {
    const levels = [
        { num: 1, name: 'Infiltration', objective: 'keycard', file: 'src/levels/level1.js' },
        { num: 2, name: 'Lockdown', objective: 'collect|data.?drive', file: 'src/levels/level2.js' },
        { num: 3, name: 'Rescue', objective: 'rescue|prisoner|free', file: 'src/levels/level3.js' },
        { num: 4, name: 'Sabotage', objective: 'plant|charge|reactor', file: 'src/levels/level4.js' },
        { num: 5, name: 'Showdown', objective: 'commander|boss', file: 'src/levels/level5.js' },
    ];

    let levelCount = 0;
    for (const level of levels) {
        const content = readFile(level.file);
        if (content) {
            levelCount++;

            // Check for map data (2D array) - may use 'map:' as object property
            if (searchFor(content, /map\s*:|grid|tiles|layout/i) && searchFor(content, /\[/)) {
                addResult(`level_${level.num}_map`, 'PASS', `Level ${level.num} has map data`);
            } else {
                addResult(`level_${level.num}_map`, 'FAIL', `Level ${level.num} missing tile map data`);
            }

            // Check for objective
            const objRegex = new RegExp(level.objective, 'i');
            if (searchFor(content, objRegex)) {
                addResult(`level_${level.num}_objective`, 'PASS', `Level ${level.num} "${level.name}" has matching objective`);
            } else {
                addResult(`level_${level.num}_objective`, 'FAIL', `Level ${level.num} missing expected objective (${level.objective})`);
            }

            // Check for enemy spawns
            if (searchFor(content, /enem|spawn|grunt|soldier|scout|brute/i)) {
                addResult(`level_${level.num}_enemies`, 'PASS', `Level ${level.num} has enemy definitions`);
            } else {
                addResult(`level_${level.num}_enemies`, 'FAIL', `Level ${level.num} missing enemy spawn definitions`);
            }
        } else {
            addResult(`level_${level.num}_exists`, 'FAIL', `${level.file} not found`);
        }
    }

    if (levelCount >= 5) {
        addResult('levels_all_five', 'PASS', `All 5 levels found`);
    } else {
        addResult('levels_all_five', 'FAIL', `Only ${levelCount}/5 levels found`);
    }
}

// =========================================================================
// Item and Door Checks
// =========================================================================
function checkItems() {
    const itemFile = readFile('src/game/item.js');
    if (itemFile) {
        addResult('items_module', 'PASS', 'Item module exists');

        const itemTypes = ['health', 'ammo', 'armor', 'key'];
        const foundItems = itemTypes.filter(t => searchFor(itemFile, new RegExp(t, 'i')));
        if (foundItems.length >= 3) {
            addResult('items_types', 'PASS', `Item types found: ${foundItems.join(', ')}`);
        } else {
            addResult('items_types', 'FAIL', `Only ${foundItems.length}/4 item types found: ${foundItems.join(', ')}`);
        }
    } else {
        addResult('items_module', 'FAIL', 'src/game/item.js not found');
    }

    const doorFile = readFile('src/game/door.js');
    if (doorFile) {
        addResult('doors_module', 'PASS', 'Door module exists');

        if (searchFor(doorFile, /key|lock|keycard/i)) {
            addResult('doors_keycards', 'PASS', 'Keycard/locked door mechanics found');
        } else {
            addResult('doors_keycards', 'FAIL', 'No keycard/locked door mechanics found');
        }
    } else {
        addResult('doors_module', 'FAIL', 'src/game/door.js not found');
    }
}

// =========================================================================
// Audio Checks
// =========================================================================
function checkAudio() {
    const audioFile = readFile('src/audio/audio.js');
    if (!audioFile) {
        addResult('audio_module', 'FAIL', 'src/audio/audio.js not found');
        return;
    }
    addResult('audio_module', 'PASS', 'Audio module exists');

    if (searchFor(audioFile, /AudioContext|Web.?Audio|OscillatorNode|oscillator/i)) {
        addResult('audio_web_api', 'PASS', 'Web Audio API usage detected');
    } else {
        addResult('audio_web_api', 'FAIL', 'No Web Audio API usage detected');
    }

    // Check for weapon sounds
    if (searchFor(audioFile, /weapon|fire|shoot|gun|pistol|shotgun/i)) {
        addResult('audio_weapons', 'PASS', 'Weapon sound generation detected');
    } else {
        addResult('audio_weapons', 'FAIL', 'No weapon sound generation detected');
    }
}

// =========================================================================
// Run all checks
// =========================================================================
console.log('=== Mechanics Verification ===');
console.log(`Submission: ${submissionDir}`);
console.log('');

checkWeapons();
checkEnemies();
checkAI();
checkLevels();
checkItems();
checkAudio();

console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
console.log('');

// Output JSON
const output = {
    tool: 'verify-mechanics',
    submission: submissionDir,
    summary: { pass: passCount, fail: failCount },
    results,
};

console.log(JSON.stringify(output, null, 2));
