#!/usr/bin/env bash
# run-evaluation.sh - Run the full retro-fury evaluation pipeline
#
# Usage: ./tools/run-evaluation.sh [submission-id]
#
# If no submission-id is given, uses the most recent submission.
# Runs all verification tools and produces a summary report.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUBMISSIONS_DIR="$REPO_ROOT/submissions"
REPORTS_DIR="$REPO_ROOT/reports"

# Determine submission directory
if [ $# -ge 1 ]; then
    SUBMISSION_ID="$1"
    SUBMISSION_DIR="$SUBMISSIONS_DIR/$SUBMISSION_ID"
else
    # Find the most recent submission
    SUBMISSION_ID=$(ls -1 "$SUBMISSIONS_DIR" 2>/dev/null | grep -v '.gitkeep' | sort -r | head -1)
    if [ -z "$SUBMISSION_ID" ]; then
        echo "ERROR: No submissions found in $SUBMISSIONS_DIR"
        echo "Run ./tools/submit.sh <path-to-retro-fury> first."
        exit 1
    fi
    SUBMISSION_DIR="$SUBMISSIONS_DIR/$SUBMISSION_ID"
fi

if [ ! -d "$SUBMISSION_DIR" ]; then
    echo "ERROR: Submission not found: $SUBMISSION_DIR"
    exit 1
fi

TIMESTAMP=$(date +%Y-%m-%d-%H%M%S)
REPORT_FILE="$REPORTS_DIR/$TIMESTAMP.md"
RESULTS_DIR="$REPORTS_DIR/$TIMESTAMP-results"

mkdir -p "$RESULTS_DIR"

echo "============================================"
echo "  RETRO FURY EVALUATION PIPELINE"
echo "============================================"
echo ""
echo "Submission: $SUBMISSION_DIR"
echo "Report:     $REPORT_FILE"
echo "Timestamp:  $TIMESTAMP"
echo ""

# =========================================================================
# Run each tool and capture output
# =========================================================================

total_pass=0
total_fail=0

run_tool() {
    local name="$1"
    local cmd="$2"
    local output_file="$RESULTS_DIR/$name.json"

    echo "--- Running: $name ---"

    if eval "$cmd" > "$output_file" 2>&1; then
        echo "  Completed."
    else
        echo "  Completed (with errors)."
    fi

    # Extract pass/fail counts from output
    local pass=$(grep -o '"pass": [0-9]*' "$output_file" | head -1 | grep -o '[0-9]*' || echo "0")
    local fail=$(grep -o '"fail": [0-9]*' "$output_file" | head -1 | grep -o '[0-9]*' || echo "0")
    total_pass=$((total_pass + pass))
    total_fail=$((total_fail + fail))
    echo "  Pass: $pass | Fail: $fail"
    echo ""
}

run_tool "validate-structure" "bash $SCRIPT_DIR/validate-structure.sh $SUBMISSION_DIR"
run_tool "check-syntax" "bash $SCRIPT_DIR/check-syntax.sh $SUBMISSION_DIR"
run_tool "verify-mechanics" "node $SCRIPT_DIR/verify-mechanics.js $SUBMISSION_DIR"
run_tool "verify-rendering" "node $SCRIPT_DIR/verify-rendering.js $SUBMISSION_DIR"
run_tool "verify-multiplayer" "node $SCRIPT_DIR/verify-multiplayer.js $SUBMISSION_DIR"
run_tool "test-server" "bash $SCRIPT_DIR/test-server.sh $SUBMISSION_DIR"

# =========================================================================
# Generate summary report
# =========================================================================

total_checks=$((total_pass + total_fail))
if [ "$total_checks" -gt 0 ]; then
    score=$(( (total_pass * 100) / total_checks ))
else
    score=0
fi

# Check for critical failures by scanning results for FAIL on critical check IDs.
# Critical checks are defined in criteria.yaml. We maintain a hardcoded list here
# for the shell-based runner; the agent (visionary) also checks criteria.yaml.
CRITICAL_CHECKS="engine_raycaster weapons_all_five enemies_all_five levels_all_five ai_state_machine mp_server_exists mp_server_starts code_syntax mp_remote_bind mp_client_configurable_host mp_pointer_lock_game_start"
critical_fail=0
critical_fail_list=""

for result_file in "$RESULTS_DIR"/*.json; do
    for crit_id in $CRITICAL_CHECKS; do
        if grep -q "\"check_id\": \"$crit_id\"" "$result_file" 2>/dev/null; then
            # Check if this critical check failed
            if grep -A1 "\"check_id\": \"$crit_id\"" "$result_file" | grep -q '"FAIL"'; then
                critical_fail=$((critical_fail + 1))
                critical_fail_list="$critical_fail_list $crit_id"
            fi
        fi
    done
done

if [ "$critical_fail" -gt 0 ]; then
    verdict="REJECTED"
elif [ "$score" -ge 80 ]; then
    verdict="APPROVED"
elif [ "$score" -ge 60 ]; then
    verdict="APPROVED (PARTIAL)"
else
    verdict="REJECTED"
fi

cat > "$REPORT_FILE" << EOF
# Retro Fury Evaluation Report

**Date**: $(date +%Y-%m-%d)
**Submission**: $SUBMISSION_ID
**Verdict**: $verdict
**Score**: $score% ($total_pass/$total_checks checks passed)

## Summary

Automated evaluation of retro-fury game submission. $total_pass of $total_checks checks passed across all verification tools.

## Automated Check Results

| Tool | Pass | Fail |
|------|------|------|
EOF

# Add per-tool results to report
for result_file in "$RESULTS_DIR"/*.json; do
    tool_name=$(basename "$result_file" .json)
    pass=$(grep -o '"pass": [0-9]*' "$result_file" | head -1 | grep -o '[0-9]*' || echo "0")
    fail=$(grep -o '"fail": [0-9]*' "$result_file" | head -1 | grep -o '[0-9]*' || echo "0")
    echo "| $tool_name | $pass | $fail |" >> "$REPORT_FILE"
done

cat >> "$REPORT_FILE" << EOF

## Detailed Results

Individual tool results are in \`$TIMESTAMP-results/\`.

## Vision Alignment

_To be filled by evaluator agent after reviewing detailed results._

## Gaps

_To be filled by evaluator agent._

## Feedback

_To be filled by evaluator agent._
EOF

echo "============================================"
echo "  EVALUATION COMPLETE"
echo "============================================"
echo ""
echo "Verdict: $verdict"
echo "Score:   $score% ($total_pass/$total_checks passed)"
echo ""
echo "Report:  $REPORT_FILE"
echo "Details: $RESULTS_DIR/"
