#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/local/aws-env.sh"
HTTP_API_ENDPOINT="$(python3 "$ROOT/local/get-output.py" HttpApiEndpoint)"
API_HOST="${HTTP_API_ENDPOINT#*://}"
API_ID="${API_HOST%%.*}"
export TEST_API_BASE_URL="$AWS_ENDPOINT_URL/execute-api/$API_ID/\$default"
export TEST_ACCESS_TOKEN="$($ROOT/local/get-token.sh)"
export TEST_LOCAL_USER_ID="${TEST_LOCAL_USER_ID:-local-basic-user}"
export TEST_LOCAL_GROUPS="${TEST_LOCAL_GROUPS:-tier-basic}"
python3 "$ROOT/local/smoke_test.py"
