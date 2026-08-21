#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/local/aws-env.sh"
USERNAME="${1:-basic@example.test}"
PASSWORD="${2:-LocalPassw0rd!}"
GROUP="${3:-tier-basic}"
USER_POOL_ID="$(python3 "$ROOT/local/get-output.py" UserPoolId)"

for tier_group in tier-basic tier-standard tier-premium; do
  aws cognito-idp create-group \
    --user-pool-id "$USER_POOL_ID" \
    --group-name "$tier_group" \
    --description "Inference concurrency tier: $tier_group" \
    --endpoint-url "$AWS_ENDPOINT_URL" >/dev/null 2>&1 || true
done

aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --user-attributes Name=email,Value="$USERNAME" Name=email_verified,Value=true \
  --message-action SUPPRESS \
  --endpoint-url "$AWS_ENDPOINT_URL" >/dev/null 2>&1 || true

aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --password "$PASSWORD" \
  --permanent \
  --endpoint-url "$AWS_ENDPOINT_URL"

aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --group-name "$GROUP" \
  --endpoint-url "$AWS_ENDPOINT_URL"

echo "Created/updated $USERNAME in $GROUP"
