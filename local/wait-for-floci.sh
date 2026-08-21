#!/usr/bin/env bash
set -euo pipefail
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:4566/_floci/init >/dev/null 2>&1; then
    echo "Floci is ready."
    exit 0
  fi
  sleep 1
done
echo "Floci did not become ready." >&2
exit 1
