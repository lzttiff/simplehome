#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RUNS="${1:-3}"
if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [[ "$RUNS" -lt 1 ]]; then
  echo "Usage: $0 [positive integer run count]"
  exit 2
fi

echo "Running client stability check for $RUNS iteration(s)..."

for i in $(seq 1 "$RUNS"); do
  echo "=== Stability iteration $i/$RUNS ==="
  NODE_OPTIONS=--max-old-space-size=4096 npx jest --runInBand --silent \
    --testMatch='**/client/src/components/task-card.test.tsx' \
    --testMatch='**/client/src/pages/dashboard.test.tsx'
done

echo "Client stability check passed for $RUNS iteration(s)."
