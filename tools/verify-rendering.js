#!/usr/bin/env node
// verify-rendering.js - Verify rendering engine implementation
//
// Usage: node tools/verify-rendering.js <submission-dir>
//
// Checks that the raycasting engine, renderer, camera, sprite system,
// and procedural textures are implemented according to the vision.

const fs = require('fs');
const path = require('path');

const submissionDir = process.argv[2];
if (!submissionDir) {
    console.error('Usage: node verify-rendering.js <submission-dir>');
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
// Raycaster
// =========================================================================
function checkRaycaster() {
    const content = readFile('src/engine/raycaster.js');
    if (!content) {
        addResult('raycaster_exists', 'FAIL', 'src/engine/raycaster.js not found');
        return;
    }
    addResult('raycaster_exists', 'PASS', 'Raycaster module exists');

    // Check for DDA algorithm indicators
    if (searchFor(content, /DDA|stepX|stepY|sideDistX|sideDistY|deltaDistX|deltaDistY/i) ||
        searchFor(content, /rayDir|mapX|mapY|side/i)) {
        addResult('raycaster_dda', 'PASS', 'DDA algorithm patterns detected');
    } else {
        addResult('raycaster_dda', 'FAIL', 'No DDA algorithm patterns detected');
    }

    // Check for perpendicular distance (fisheye correction)
    if (searchFor(content, /perpWallDist|perpendicular|wallDist/i) ||
        searchFor(content, /cos|Math\.cos/)) {
        addResult('raycaster_perp_dist', 'PASS', 'Perpendicular distance calculation detected');
    } else {
        addResult('raycaster_perp_dist', 'FAIL', 'No perpendicular distance calculation (fisheye may occur)');
    }

    // Check for wall texturing
    if (searchFor(content, /texture|texX|texY|wallX/i)) {
        addResult('raycaster_textures', 'PASS', 'Wall texture mapping detected');
    } else {
        addResult('raycaster_textures', 'FAIL', 'No wall texture mapping detected');
    }

    // Check for side shading
    if (searchFor(content, /side|shad|darken|dim/i)) {
        addResult('raycaster_side_shade', 'PASS', 'Side-dependent shading detected');
    } else {
        addResult('raycaster_side_shade', 'FAIL', 'No side-dependent shading detected');
    }

    // Check for depth/fog
    if (searchFor(content, /fog|depth|distance.*shad|darken.*dist/i)) {
        addResult('raycaster_fog', 'PASS', 'Distance-based shading/fog detected');
    } else {
        addResult('raycaster_fog', 'FAIL', 'No distance-based shading/fog detected');
    }
}

// =========================================================================
// Renderer
// =========================================================================
function checkRenderer() {
    const content = readFile('src/engine/renderer.js');
    if (!content) {
        addResult('renderer_exists', 'FAIL', 'src/engine/renderer.js not found');
        return;
    }
    addResult('renderer_exists', 'PASS', 'Renderer module exists');

    // Check canvas usage
    if (searchFor(content, /canvas|getContext|2d|ctx/i)) {
        addResult('renderer_canvas', 'PASS', 'Canvas 2D rendering context detected');
    } else {
        addResult('renderer_canvas', 'FAIL', 'No Canvas 2D context usage detected');
    }

    // Check for resolution (320x200 or similar retro resolution)
    if (searchFor(content, /320|200/) || searchFor(content, /width.*320|height.*200/i)) {
        addResult('renderer_resolution', 'PASS', '320x200 resolution references found');
    } else {
        addResult('renderer_resolution', 'FAIL', 'No 320x200 resolution references found');
    }

    // Check for ImageData or pixel-level rendering
    if (searchFor(content, /ImageData|putImageData|createImageData|imageData|getImageData/i)) {
        addResult('renderer_imagedata', 'PASS', 'ImageData pixel manipulation detected');
    } else if (searchFor(content, /drawImage|fillRect/i)) {
        addResult('renderer_imagedata', 'PASS', 'Canvas drawing operations detected (alternative rendering)');
    } else {
        addResult('renderer_imagedata', 'FAIL', 'No pixel-level rendering detected');
    }
}

// =========================================================================
// Camera
// =========================================================================
function checkCamera() {
    const content = readFile('src/engine/camera.js');
    if (!content) {
        addResult('camera_exists', 'FAIL', 'src/engine/camera.js not found');
        return;
    }
    addResult('camera_exists', 'PASS', 'Camera module exists');

    // Check for FOV
    if (searchFor(content, /fov|field.?of.?view|66|0\.66/i)) {
        addResult('camera_fov', 'PASS', 'FOV configuration detected');
    } else {
        addResult('camera_fov', 'FAIL', 'No FOV configuration detected');
    }

    // Check for position/rotation
    if (searchFor(content, /position|angle|rotation|direction|dir/i)) {
        addResult('camera_transform', 'PASS', 'Camera position/rotation properties detected');
    } else {
        addResult('camera_transform', 'FAIL', 'No camera position/rotation properties detected');
    }
}

// =========================================================================
// Sprite System
// =========================================================================
function checkSprites() {
    const content = readFile('src/engine/sprite.js');
    if (!content) {
        addResult('sprite_exists', 'FAIL', 'src/engine/sprite.js not found');
        return;
    }
    addResult('sprite_exists', 'PASS', 'Sprite renderer module exists');

    // Check for depth sorting
    if (searchFor(content, /sort|depth|zBuffer|z.?buffer|distance/i)) {
        addResult('sprite_depth_sort', 'PASS', 'Sprite depth sorting detected');
    } else {
        addResult('sprite_depth_sort', 'FAIL', 'No sprite depth sorting detected');
    }

    // Check for billboarding
    if (searchFor(content, /billboard|screen|transform|project/i)) {
        addResult('sprite_billboard', 'PASS', 'Billboard sprite projection detected');
    } else {
        addResult('sprite_billboard', 'FAIL', 'No billboard sprite projection detected');
    }
}

// =========================================================================
// Procedural Textures
// =========================================================================
function checkTextures() {
    const content = readFile('src/utils/textures.js');
    if (!content) {
        addResult('textures_exists', 'FAIL', 'src/utils/textures.js not found');
        return;
    }
    addResult('textures_exists', 'PASS', 'Texture generator module exists');

    // Check for ImageData generation
    if (searchFor(content, /ImageData|createImageData|Uint8ClampedArray/i)) {
        addResult('textures_imagedata', 'PASS', 'Procedural ImageData texture generation detected');
    } else {
        addResult('textures_imagedata', 'FAIL', 'No procedural ImageData generation detected');
    }

    // Check for 64x64 texture size
    if (searchFor(content, /64/)) {
        addResult('textures_size', 'PASS', '64x64 texture size references found');
    } else {
        addResult('textures_size', 'FAIL', 'No 64x64 texture size references found');
    }

    // Check for multiple texture types
    const texTypes = ['brick', 'concrete', 'door', 'crate', 'metal', 'lab', 'tech', 'prison'];
    const foundTypes = texTypes.filter(t => searchFor(content, new RegExp(t, 'i')));
    if (foundTypes.length >= 3) {
        addResult('textures_variety', 'PASS', `Multiple texture types found: ${foundTypes.join(', ')}`);
    } else {
        addResult('textures_variety', 'FAIL', `Only ${foundTypes.length} texture types found. Expected >= 3.`);
    }
}

// =========================================================================
// Collision System
// =========================================================================
function checkCollision() {
    const playerFile = readFile('src/game/player.js');
    const mathFile = readFile('src/utils/math.js');
    const combined = (playerFile || '') + (mathFile || '');

    if (searchFor(combined, /collision|collide|intersect|wall.?slide|sliding/i)) {
        addResult('collision_system', 'PASS', 'Collision system detected');
    } else {
        addResult('collision_system', 'FAIL', 'No collision system detected');
    }

    if (searchFor(combined, /radius|circle|0\.25/i)) {
        addResult('collision_circle', 'PASS', 'Circle-based collision (player radius) detected');
    } else {
        addResult('collision_circle', 'FAIL', 'No circle-based collision detected');
    }
}

// =========================================================================
// Run all checks
// =========================================================================
console.log('=== Rendering Verification ===');
console.log(`Submission: ${submissionDir}`);
console.log('');

checkRaycaster();
checkRenderer();
checkCamera();
checkSprites();
checkTextures();
checkCollision();

console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
console.log('');

const output = {
    tool: 'verify-rendering',
    submission: submissionDir,
    summary: { pass: passCount, fail: failCount },
    results,
};

console.log(JSON.stringify(output, null, 2));
