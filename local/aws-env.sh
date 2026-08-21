#!/usr/bin/env bash
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-northeast-1}"
export AWS_REGION="$AWS_DEFAULT_REGION"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_PAGER=""

if grep -qi microsoft /proc/version 2>/dev/null && command -v cmd.exe >/dev/null 2>&1; then
  export WSLENV="${WSLENV:+$WSLENV:}AWS_ENDPOINT_URL/w:AWS_DEFAULT_REGION/w:AWS_REGION/w:AWS_ACCESS_KEY_ID/w:AWS_SECRET_ACCESS_KEY/w:AWS_PAGER/w"
  export AWS_CLI_COMMAND="$(wslpath -w "$ROOT/scripts/aws.cmd")"
  export AWS_CLI_RUNNER="cmd.exe"
  aws() {
    cmd.exe /d /c "$AWS_CLI_COMMAND" --region "$AWS_DEFAULT_REGION" --no-sign-request "$@"
  }
else
  export AWS_CLI_COMMAND="aws"
  unset AWS_CLI_RUNNER
fi
