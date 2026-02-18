# Retro Fury Evaluator

Evaluation pipeline for the [retro-fury](https://github.com/bencivjan/retro-fury) retro FPS game. Assesses game submissions against the project vision using the [attractor-go evaluator.dot](../attractor-go/attractor/pipelines/evaluator.dot) pipeline pattern.

## For Game Developers: How to Submit Your Game

### Prerequisites

- Node.js 18+ installed
- The retro-fury game code in a local directory

### Submission Steps

1. **Clone this evaluator repo** (if you haven't already):
   ```bash
   git clone https://github.com/bencivjan/retro-fury-evaluator.git
   cd retro-fury-evaluator
   ```

2. **Submit your game for evaluation**:
   ```bash
   ./tools/submit.sh /path/to/your/retro-fury
   ```
   This copies your game code into the `submissions/` directory for review.

3. **Run the automated evaluation**:
   ```bash
   ./tools/run-evaluation.sh
   ```
   This executes all verification tools against your submission and produces a summary.

4. **Review results**: Check the output in `reports/` for your evaluation report.

### What Gets Evaluated

| Dimension | Weight | What We Check |
|-----------|--------|---------------|
| Core Engine | 25% | Raycasting, rendering, collision, camera, textures |
| Gameplay | 25% | Weapons, enemies, items, doors, objectives, all 5 levels |
| AI System | 15% | State machine, line-of-sight, pathfinding, behaviors |
| Multiplayer | 20% | WebSocket server, protocol, gun game mode, arena map |
| UI/Audio | 10% | HUD, menus, minimap, audio system, transitions |
| Code Quality | 5% | Module structure, consistency, no dead code |

### Evaluation Verdicts

- **APPROVED** - Submission fully satisfies the vision
- **APPROVED (PARTIAL)** - Core functionality works but some features are incomplete
- **REJECTED** - Significant gaps or broken functionality; feedback provided

## For Evaluator Agents

See [CLAUDE.md](./CLAUDE.md) for detailed agent instructions. The evaluation follows the 4-stage pipeline:

1. **Orchestrator** - Analyze submission against vision, produce delegation plan
2. **Builder** - Build/run verification tools and test harnesses
3. **QA** - Execute tools, record PASS/FAIL per checklist item
4. **Visionary** - Judge submission against full vision, provide feedback

## Pipeline Reference

This evaluator is based on the evaluator.dot pipeline from [attractor-go](../attractor-go/attractor/pipelines/evaluator.dot). See `evaluation/pipeline.dot` for the retro-fury-specific configuration.
