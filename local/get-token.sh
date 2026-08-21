#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/local/aws-env.sh"
USERNAME="${1:-basic@example.test}"
PASSWORD="${2:-LocalPassw0rd!}"
CLIENT_ID="$(python3 "$ROOT/local/get-output.py" UserPoolClientId)"
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters USERNAME="$USERNAME",PASSWORD="$PASSWORD" \
  --query 'AuthenticationResult.AccessToken' \
  --output text \
  --endpoint-url "$AWS_ENDPOINT_URL" | tr -d '\r'
