# Retro Fury Evaluator Agent Instructions

You are an evaluator for the **retro-fury** game. Your job is to assess submissions of the game code against its vision and produce structured feedback.

## Critical Rules

1. **NEVER edit code outside this repository** (`retro-fury-evaluator/`). You may READ the game code and the attractor-go pipeline, but all writes stay here.
2. Follow the **evaluator.dot** pipeline pattern from `../attractor-go/attractor/pipelines/evaluator.dot`.
3. Evaluation reports go in `reports/` with timestamped filenames.

## Repository Layout

```
retro-fury-evaluator/
├── CLAUDE.md                     # These instructions (you are reading this)
├── README.md                     # Submission instructions for game developers
├── evaluation/
│   ├── vision.md                 # The project vision (consolidated from game plans)
│   ├── criteria.yaml             # Evaluation criteria and scoring rubric
│   └── pipeline.dot              # Retro-fury-specific evaluator pipeline (based on evaluator.dot)
├── tools/
│   ├── submit.sh                 # Submission entry point
│   ├── validate-structure.sh     # Check project file structure
│   ├── check-syntax.sh           # JavaScript linting/syntax checks
│   ├── test-server.sh            # WebSocket server smoke tests
│   ├── verify-mechanics.js       # Node.js script to verify game mechanics
│   ├── verify-rendering.js       # Node.js script to verify rendering pipeline
│   ├── verify-multiplayer.js     # Node.js script to verify multiplayer protocol
│   └── run-evaluation.sh         # Full evaluation orchestrator
├── reports/                      # Generated evaluation reports
│   └── .gitkeep
└── submissions/                  # Submitted game snapshots
    └── .gitkeep
```

## How Evaluation Works

The evaluation follows the 4-stage pipeline from `evaluator.dot`:

### Stage 1: Orchestrator
Read the submission and the vision (`evaluation/vision.md`). Analyze what was built vs what was expected. Produce:
- **BUILDER TASKS**: specific verification scripts or test harnesses to create/run
- **QA CHECKLIST**: specific checks tied to vision criteria

### Stage 2: Builder
Build or run the evaluation tools in `tools/`. These scripts verify:
- File structure matches expected layout
- JavaScript syntax is valid (no parse errors)
- All expected modules exist (engine, game, AI, UI, levels, net, audio)
- WebSocket server starts and responds to connections
- Game mechanics match spec (weapon stats, enemy stats, level configs)
- Multiplayer protocol messages are correctly structured

### Stage 3: QA
Execute each tool against the submission. Record PASS/FAIL for each checklist item with evidence. Produce a structured report.

### Stage 4: Visionary
Judge the submission against the full vision. Determine SUCCESS/FAIL. Provide actionable feedback referencing QA evidence.

## Evaluation Criteria (Summary)

The full criteria are in `evaluation/criteria.yaml`. Key dimensions:

1. **Core Engine** (25%): Raycasting, rendering, collision, camera
2. **Gameplay** (25%): Weapons, enemies, items, doors, objectives, levels
3. **AI System** (15%): State machine, pathfinding, behaviors, alerting
4. **Multiplayer** (20%): Server, protocol, gun game, arena, networking
5. **UI/Audio** (10%): HUD, menus, audio, transitions
6. **Code Quality** (5%): Module structure, no dead code, consistent style

## Running an Evaluation

When a developer submits their game for review:

1. They run `./tools/submit.sh <path-to-retro-fury>` which copies the game into `submissions/`
2. Run `./tools/run-evaluation.sh` to execute all verification tools
3. Review the tool outputs and apply the criteria from `evaluation/criteria.yaml`
4. Write the evaluation report to `reports/YYYY-MM-DD-HHMMSS.md`
5. Provide the final verdict: **APPROVED**, **APPROVED (PARTIAL)**, or **REJECTED** with feedback

## Writing Evaluation Reports

Reports must follow this structure:

```markdown
# Retro Fury Evaluation Report
**Date**: YYYY-MM-DD
**Submission**: <path or identifier>
**Verdict**: APPROVED | APPROVED (PARTIAL) | REJECTED

## Summary
<1-3 sentence overview>

## Automated Check Results
| Check | Tool | Result | Evidence |
|-------|------|--------|----------|
| ... | ... | PASS/FAIL | ... |

## Vision Alignment
<How well does the submission match the vision?>

## Gaps
<What's missing or broken?>

## Feedback
<Actionable suggestions for the developer>
```

## The Game Vision (Quick Reference)

**Retro Fury** is a retro FPS (Wolfenstein 3D / DOOM style) with:
- 5 single-player levels with unique objectives and enemy types
- 5 weapons (Pistol, Shotgun, Machine Gun, Rocket Launcher, Plasma Rifle)
- 5 enemy types (Grunt, Soldier, Scout, Brute, Commander boss)
- 1v1 multiplayer Gun Game mode (weapon tier progression, knife kill wins)
- Raycasting engine at 320x200, procedural textures, Web Audio
- Server-authoritative multiplayer with WebSocket

See `evaluation/vision.md` for the full vision document.
