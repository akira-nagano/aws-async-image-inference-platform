#!/usr/bin/env python3
from __future__ import annotations

import os
import pathlib
import subprocess
import sys


root = pathlib.Path(__file__).resolve().parents[1]
env = os.environ.copy()
env.setdefault("AWS_ENDPOINT_URL", "http://localhost:4566")
env.setdefault("AWS_DEFAULT_REGION", "ap-northeast-1")
env.setdefault("AWS_REGION", env["AWS_DEFAULT_REGION"])
env.setdefault("AWS_ACCESS_KEY_ID", "test")
env.setdefault("AWS_SECRET_ACCESS_KEY", "test")
env.setdefault("AWS_PAGER", "")
endpoint = subprocess.check_output(
    [sys.executable, str(root / "local/get-output.py"), "HttpApiEndpoint"],
    cwd=root,
    env=env,
    text=True,
).strip()
api_id = endpoint.split("://", maxsplit=1)[-1].split(".", maxsplit=1)[0]
token = subprocess.check_output(
    ["bash", "./local/get-token.sh"],
    cwd=root,
    env=env,
    text=True,
).strip()

api_base_url = (
    f"{env.get('AWS_ENDPOINT_URL', 'http://localhost:4566')}"
    f"/execute-api/{api_id}/$default"
)


def run_tier_scenario(
    *,
    name: str,
    access_token: str,
    local_user_id: str,
    local_groups: str,
    expected_limit: int,
    submission_count: int,
) -> None:
    scenario_env = env.copy()
    scenario_env.update(
        {
            "TEST_API_BASE_URL": api_base_url,
            "TEST_ACCESS_TOKEN": access_token,
            "TEST_LOCAL_USER_ID": local_user_id,
            "TEST_LOCAL_GROUPS": local_groups,
            "TEST_EXPECTED_TIER_LIMIT": str(expected_limit),
            "TEST_SUBMISSION_COUNT": str(submission_count),
        }
    )
    print(f"Running {name}: {submission_count} submissions, limit {expected_limit}")
    subprocess.run(
        ["bun", "test", "tests/integration/test"],
        cwd=root,
        env=scenario_env,
        check=True,
    )


run_tier_scenario(
    name="tier-basic",
    access_token=token,
    local_user_id="local-basic-integration",
    local_groups="tier-basic",
    expected_limit=1,
    submission_count=2,
)

subprocess.run(
    [
        "bash",
        "./local/seed-cognito-user.sh",
        "standard@example.test",
        "LocalPassw0rd!",
        "tier-standard",
    ],
    cwd=root,
    env=env,
    check=True,
)
standard_token = subprocess.check_output(
    [
        "bash",
        "./local/get-token.sh",
        "standard@example.test",
        "LocalPassw0rd!",
    ],
    cwd=root,
    env=env,
    text=True,
).strip()
run_tier_scenario(
    name="tier-standard",
    access_token=standard_token,
    local_user_id="local-standard-integration",
    local_groups="tier-standard",
    expected_limit=3,
    submission_count=10,
)

subprocess.run(
    [sys.executable, str(root / "local/verify-lifecycle.py")],
    cwd=root,
    env=env,
    check=True,
)
