#!/usr/bin/env bash
# submit.sh - Submit a retro-fury game for evaluation
#
# Usage: ./tools/submit.sh /path/to/retro-fury
#
# Copies the game code into submissions/ for evaluation.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUBMISSIONS_DIR="$REPO_ROOT/submissions"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <path-to-retro-fury>"
    echo ""
    echo "Submit a retro-fury game for evaluation."
    echo "The game code will be copied into submissions/ for review."
    exit 1
fi

GAME_PATH="$1"

if [ ! -d "$GAME_PATH" ]; then
    echo "ERROR: '$GAME_PATH' is not a directory"
    exit 1
fi

if [ ! -f "$GAME_PATH/index.html" ]; then
    echo "WARNING: No index.html found in '$GAME_PATH'. Are you sure this is a retro-fury game?"
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
SUBMISSION_DIR="$SUBMISSIONS_DIR/$TIMESTAMP"

echo "=== Retro Fury Submission ==="
echo "Source: $GAME_PATH"
echo "Target: $SUBMISSION_DIR"
echo ""

mkdir -p "$SUBMISSION_DIR"

# Copy game files, excluding node_modules and .git
rsync -a \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='.DS_Store' \
    "$GAME_PATH/" "$SUBMISSION_DIR/"

echo "Submission copied successfully."
echo ""

# Write submission metadata
cat > "$SUBMISSION_DIR/.submission-meta.json" << EOF
{
    "source_path": "$GAME_PATH",
    "submitted_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "submission_id": "$TIMESTAMP"
}
EOF

# Count files
FILE_COUNT=$(find "$SUBMISSION_DIR" -type f | wc -l | tr -d ' ')
echo "Files submitted: $FILE_COUNT"
echo "Submission ID: $TIMESTAMP"
echo ""
echo "To run the evaluation:"
echo "  ./tools/run-evaluation.sh $TIMESTAMP"
