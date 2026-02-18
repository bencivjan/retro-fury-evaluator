#!/usr/bin/env bash
# check-syntax.sh - Check JavaScript syntax validity
#
# Usage: ./tools/check-syntax.sh <submission-dir>
#
# Validates that all .js files in the submission parse without syntax errors.
# Uses Node.js --check flag for syntax validation.

set -euo pipefail

SUBMISSION_DIR="${1:?Usage: $0 <submission-dir>}"

pass_count=0
fail_count=0
results=()

echo "=== Syntax Validation ==="
echo "Submission: $SUBMISSION_DIR"
echo ""

# Find all .js files
while IFS= read -r -d '' jsfile; do
    relative="${jsfile#$SUBMISSION_DIR/}"

    # Skip node_modules
    if [[ "$relative" == node_modules/* ]]; then
        continue
    fi

    # Check if file uses ES modules (import/export)
    if grep -qE '^\s*(import |export )' "$jsfile" 2>/dev/null; then
        # ES module - use --input-type=module
        if node --input-type=module --check < "$jsfile" 2>/dev/null; then
            results+=("{\"check_id\": \"syntax_${relative//\//_}\", \"result\": \"PASS\", \"evidence\": \"Valid ES module: $relative\"}")
            pass_count=$((pass_count + 1))
        else
            error=$(node --input-type=module --check < "$jsfile" 2>&1 || true)
            # Escape JSON special characters in error
            error="${error//\\/\\\\}"
            error="${error//\"/\\\"}"
            error="${error//$'\n'/\\n}"
            results+=("{\"check_id\": \"syntax_${relative//\//_}\", \"result\": \"FAIL\", \"evidence\": \"Syntax error in $relative: $error\"}")
            fail_count=$((fail_count + 1))
        fi
    else
        # CommonJS or plain script
        if node --check "$jsfile" 2>/dev/null; then
            results+=("{\"check_id\": \"syntax_${relative//\//_}\", \"result\": \"PASS\", \"evidence\": \"Valid syntax: $relative\"}")
            pass_count=$((pass_count + 1))
        else
            error=$(node --check "$jsfile" 2>&1 || true)
            error="${error//\\/\\\\}"
            error="${error//\"/\\\"}"
            error="${error//$'\n'/\\n}"
            results+=("{\"check_id\": \"syntax_${relative//\//_}\", \"result\": \"FAIL\", \"evidence\": \"Syntax error in $relative: $error\"}")
            fail_count=$((fail_count + 1))
        fi
    fi
done < <(find "$SUBMISSION_DIR" -name "*.js" -type f -print0)

# Check for framework imports (should be vanilla JS)
framework_found=""
while IFS= read -r -d '' jsfile; do
    relative="${jsfile#$SUBMISSION_DIR/}"
    if [[ "$relative" == node_modules/* ]] || [[ "$relative" == server/* ]]; then
        continue
    fi
    if grep -qE "(from ['\"]react|from ['\"]vue|from ['\"]angular|require\(['\"]react|require\(['\"]vue)" "$jsfile" 2>/dev/null; then
        framework_found="$relative"
        break
    fi
done < <(find "$SUBMISSION_DIR" -name "*.js" -type f -print0)

if [ -n "$framework_found" ]; then
    results+=("{\"check_id\": \"no_frameworks\", \"result\": \"FAIL\", \"evidence\": \"Framework import detected in $framework_found. Game should use vanilla JavaScript.\"}")
    fail_count=$((fail_count + 1))
else
    results+=("{\"check_id\": \"no_frameworks\", \"result\": \"PASS\", \"evidence\": \"No framework imports detected. Vanilla JavaScript confirmed.\"}")
    pass_count=$((pass_count + 1))
fi

# Check for ES6 module usage
module_count=0
while IFS= read -r -d '' jsfile; do
    relative="${jsfile#$SUBMISSION_DIR/}"
    if [[ "$relative" == node_modules/* ]] || [[ "$relative" == server/* ]]; then
        continue
    fi
    if grep -qE '^\s*(import |export )' "$jsfile" 2>/dev/null; then
        module_count=$((module_count + 1))
    fi
done < <(find "$SUBMISSION_DIR/src" -name "*.js" -type f -print0 2>/dev/null)

if [ "$module_count" -gt 0 ]; then
    results+=("{\"check_id\": \"es6_modules\", \"result\": \"PASS\", \"evidence\": \"$module_count files use ES6 module syntax.\"}")
    pass_count=$((pass_count + 1))
else
    results+=("{\"check_id\": \"es6_modules\", \"result\": \"FAIL\", \"evidence\": \"No ES6 module usage detected in src/. Expected import/export statements.\"}")
    fail_count=$((fail_count + 1))
fi

echo "PASS: $pass_count"
echo "FAIL: $fail_count"
echo ""

# Output JSON
echo "{"
echo "  \"tool\": \"check-syntax\","
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
