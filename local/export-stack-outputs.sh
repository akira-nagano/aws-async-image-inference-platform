#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/local/aws-env.sh"
mkdir -p "$ROOT/local/.outputs" "$ROOT/apps/web/public"
python3 "$ROOT/local/get-output.py" > "$ROOT/local/.outputs/stack.json"
python3 "$ROOT/scripts/generate-web-config.py" \
  --outputs "$ROOT/local/.outputs/stack.json" \
  --output "$ROOT/apps/web/public/config.json" \
  --aws-endpoint "$AWS_ENDPOINT_URL" \
  --cognito-endpoint "/_local/cognito" \
  --local-auth-bypass \
  --poll-interval-ms 1000
cat "$ROOT/apps/web/public/config.json"
