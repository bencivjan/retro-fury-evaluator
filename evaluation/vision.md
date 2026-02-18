# Retro Fury - Project Vision

This document consolidates the full project vision from GAME_PLAN.md and MULTIPLAYER_PLAN.md. It is the authoritative reference for what the game should achieve.

## Overview

Retro Fury is a retro-style first-person shooter built with JavaScript and HTML5 Canvas, using a raycasting engine inspired by Wolfenstein 3D and DOOM. It features a 5-level single-player campaign with unique objectives and enemy types, plus a 1v1 multiplayer Gun Game PvP mode.

## Technology Stack

- **Rendering**: HTML5 Canvas 2D with raycasting engine
- **Language**: Vanilla JavaScript (ES6 modules)
- **Audio**: Web Audio API for retro sound effects
- **Assets**: Procedurally generated pixel art textures (no external asset dependencies)
- **Build**: Single HTML file + JS modules, no build tooling required
- **Server**: Node.js WebSocket server (ws library) for multiplayer
- **Target**: Modern web browsers (Chrome, Firefox, Safari, Edge)

## Expected File Structure

```
retro-fury/
├── index.html
├── css/
│   └── style.css
├── src/
│   ├── main.js
│   ├── engine/
│   │   ├── raycaster.js
│   │   ├── renderer.js
│   │   ├── sprite.js
│   │   └── camera.js
│   ├── game/
│   │   ├── player.js
│   │   ├── enemy.js
│   │   ├── enemies/
│   │   │   ├── grunt.js
│   │   │   ├── soldier.js
│   │   │   ├── scout.js
│   │   │   ├── brute.js
│   │   │   └── commander.js
│   │   ├── weapon.js
│   │   ├── projectile.js
│   │   ├── item.js
│   │   ├── door.js
│   │   ├── gun-game.js
│   │   └── remote-player.js
│   ├── levels/
│   │   ├── level-loader.js
│   │   ├── level1.js
│   │   ├── level2.js
│   │   ├── level3.js
│   │   ├── level4.js
│   │   ├── level5.js
│   │   └── arena.js
│   ├── ai/
│   │   ├── state-machine.js
│   │   ├── pathfinding.js
│   │   └── behaviors.js
│   ├── ui/
│   │   ├── hud.js
│   │   ├── minimap.js
│   │   ├── menu.js
│   │   ├── objectives.js
│   │   ├── transitions.js
│   │   ├── lobby.js
│   │   ├── kill-feed.js
│   │   └── scoreboard.js
│   ├── net/
│   │   ├── network-manager.js
│   │   └── mp-state.js
│   ├── audio/
│   │   └── audio.js
│   └── utils/
│       ├── input.js
│       ├── math.js
│       └── textures.js
├── server/
│   ├── index.js
│   ├── room.js
│   ├── game-loop.js
│   ├── protocol.js
│   └── package.json
└── pipeline/
    └── dev-pipeline.dot
```

## Core Engine Requirements

### Raycasting Engine
- DDA-based raycasting algorithm for wall rendering
- Textured walls with different textures per tile type
- Floor and ceiling rendering (solid color for performance)
- Sprite rendering with depth sorting (billboarded sprites)
- Distance-based shading/fog for depth perception
- Internal resolution: 320x200 scaled up (authentic retro resolution)
- ~66 degree field of view
- Perpendicular distance calculation (no fisheye)
- Side-dependent shading (N/S vs E/W walls)
- Depth buffer for sprite clipping

### Collision System
- Circle-vs-grid collision (0.25 tile radius) with wall sliding
- Ray/grid intersection for projectile hits
- Hitscan raycasting for weapon fire validation

### Procedural Assets
- All textures generated as ImageData (64x64 pixel sprites)
- Wall textures: brick, concrete, lab tile, prison metal, tech panel, crate, door, locked door
- Sprite textures: enemies, items, weapons, player, remote player
- Deterministic generation for consistency

## Weapons

| # | Weapon | Damage | Fire Rate | Ammo | Notes |
|---|--------|--------|-----------|------|-------|
| 1 | Pistol | 10 | Medium (~3 fps) | Infinite | Starting weapon |
| 2 | Shotgun | 8/pellet x5 (40 total) | Slow (~1.2 fps) | Shells | Spread pattern |
| 3 | Machine Gun | 8 | Very Fast (~10 fps) | Bullets | Rapid fire |
| 4 | Rocket Launcher | 80 splash | Very Slow (~0.5 fps) | Rockets | Projectile-based |
| 5 | Plasma Rifle | 25 | Fast | Cells | Energy weapon |

Multiplayer adds:
- Sniper Rifle: 100 damage, 0.8 fps, hitscan, no spread, zoom
- Knife: 200 damage (instant kill), melee range (~1.2 tiles)

## Enemy Types

| Type | HP | Speed | Weapon | Behavior |
|------|-----|-------|--------|----------|
| Grunt | 30 | Slow | Pistol | Patrol routes, basic chase |
| Soldier | 50 | Medium | Rifle | Strafes, uses cover |
| Scout | 25 | Fast | Shotgun | Rushes, flanks, zigzag |
| Brute | 150 | Very Slow | Minigun | Slow advance, suppressive fire |
| Commander | 500 | Medium | Multi-attack | Boss with 3 phases |

### AI State Machine
States: IDLE -> PATROL -> ALERT (0.5s) -> CHASE -> ATTACK -> PAIN (0.3s) -> DEATH
- Line-of-sight detection via raycasting
- Simple tile-based pathfinding
- Sound-based alerting (nearby enemies hear gunshots)
- Per-type behavior modifiers

## Single-Player Levels

### Level 1: "Infiltration" - Military Base
- Objective: Find blue keycard, reach elevator
- Enemies: 8-10 Grunts
- Items: Shotgun pickup, health, ammo
- Tutorial level

### Level 2: "Lockdown" - Underground Lab
- Objective: Collect 3 data drives
- Enemies: 12-15 Grunts + Soldiers
- Items: Machine Gun pickup, armor, health, ammo

### Level 3: "Rescue Op" - Prison Block
- Objective: Free 4 prisoners
- Enemies: 15-18 Grunts + Soldiers + Scouts
- Items: Rocket Launcher pickup, health, ammo

### Level 4: "Sabotage" - Command Center
- Objective: Plant charges at 3 reactor nodes (hold E for 3s)
- Enemies: 20+ all types including Brutes
- Items: Plasma Rifle pickup, heavy ammo, health

### Level 5: "Showdown" - Boss Fight
- Objective: Defeat Commander boss
- Boss phases: Missile barrage (100-66%) -> Charge + summon (66-33%) -> Rage mode (33-0%)
- Mixed enemies in corridors leading to arena

## Multiplayer: Gun Game Mode

### Architecture
- Server-authoritative Node.js WebSocket server
- 20 ticks/second server tick rate
- Client sends inputs, server processes and broadcasts state

### Weapon Progression
Pistol -> Shotgun -> Machine Gun -> Sniper -> Knife (victory)

### Arena Map
- 32x32 tile symmetric layout
- 4 corner rooms, central open area, L-shaped corridors with pillars
- 4 spawn points (one per quadrant)
- Respawn: 2-second timer, random spawn point

### Protocol (WebSocket JSON)
Client -> Server: create_room, join_room, ready, input
Server -> Client: room_created, player_joined, game_start, state, hit, kill, respawn, victory, opponent_disconnected

## UI Requirements

### HUD
- Health bar, armor bar, ammo counter
- Current weapon display
- Minimap (togglable with M)
- Objective tracker (Tab)
- Crosshair
- Damage flash (red overlay)
- Pickup notifications

### Menus
- Main menu with Single Player / Multiplayer choice
- Multiplayer lobby (host/join with room code)
- Pause menu (Esc)
- Death screen with retry
- Level intro/outro with stats
- Victory/defeat screens for multiplayer

### Audio
- Procedural retro sounds via Web Audio API
- Per-weapon fire sounds
- Enemy alert/pain/death sounds
- Door, pickup, objective sounds
- Boss music for level 5

## Controls
- WASD: Move/strafe
- Mouse: Look left/right (pointer lock)
- Left Click: Fire
- E: Interact (doors, objectives)
- 1-5: Switch weapons
- M: Toggle minimap
- Esc: Pause
- Tab: Show objective
