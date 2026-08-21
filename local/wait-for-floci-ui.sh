#!/usr/bin/env bash
set -euo pipefail

STATUS_URL="http://localhost:4500/api/clouds/aws/status"
for _ in $(seq 1 90); do
  if payload="$(curl -fsS "$STATUS_URL" 2>/dev/null)" &&
    grep -q '"runtime":"reachable"' <<<"$payload"; then
    echo "Floci UI is ready: http://localhost:4500"
    exit 0
  fi
  sleep 1
done

echo "Floci UI did not become ready: $STATUS_URL" >&2
exit 1
