#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import time
from collections.abc import Sequence


ROOT = pathlib.Path(__file__).resolve().parents[1]
LOCAL_STACK_NAME = "ImgFlow-local"
REQUIRED_LOCAL_OUTPUTS = {
    "HttpApiEndpoint",
    "UserPoolId",
    "UserPoolClientId",
}


def local_aws_env() -> dict[str, str]:
    env = os.environ.copy()
    env.update(
        {
            "AWS_ENDPOINT_URL": "http://localhost:4566",
            "AWS_ENDPOINT_URL_S3": "http://localhost:4566",
            "AWS_DEFAULT_REGION": "ap-northeast-1",
            "AWS_REGION": "ap-northeast-1",
            "AWS_ACCESS_KEY_ID": "test",
            "AWS_SECRET_ACCESS_KEY": "test",
            "AWS_PAGER": "",
        }
    )
    return env


def run_checked(command: Sequence[str], *, env: dict[str, str] | None = None) -> None:
    subprocess.run(command, cwd=ROOT, env=env, check=True)


def start_floci(*, include_ui: bool) -> None:
    print("[dev-local] Starting Floci.", flush=True)
    command = ["docker", "compose", "-f", "local/compose.yaml"]
    if include_ui:
        command.extend(["--profile", "dev"])
    command.extend(["up", "-d"])
    run_checked(command)
    run_checked(["bash", "./local/wait-for-floci.sh"])
    if include_ui:
        run_checked(["bash", "./local/wait-for-floci-ui.sh"])


def bootstrap_local() -> None:
    command = ["bun", "run", "--filter", "@imgflow/cdk", "bootstrap:local"]
    for attempt in range(1, 4):
        try:
            run_checked(command, env=local_aws_env())
            return
        except subprocess.CalledProcessError:
            if attempt == 3:
                raise
            print(
                f"[dev-local] Floci bootstrap connection failed; retrying ({attempt}/3).",
                flush=True,
            )
            time.sleep(2)


def deploy_local() -> None:
    run_checked(["bun", "run", "cdk:deploy:local"], env=local_aws_env())
    run_checked(["bash", "./local/export-stack-outputs.sh"], env=local_aws_env())


def seed_local_user() -> None:
    run_checked(["bash", "./local/seed-cognito-user.sh"], env=local_aws_env())


def start_web() -> None:
    run_checked(["bun", "run", "--filter", "@imgflow/web", "dev"])


def stack_outputs(stack_name: str) -> dict[str, object] | None:
    env = local_aws_env()
    env["STACK_NAME"] = stack_name
    result = subprocess.run(
        [sys.executable, str(ROOT / "local" / "get-output.py")],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    try:
        parsed = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def export_web_config() -> None:
    print(
        "[dev-local] Reusing the existing local stack and refreshing web config.",
        flush=True,
    )
    run_checked(["bash", "./local/export-stack-outputs.sh"], env=local_aws_env())


def prepare_local(*, force_deploy: bool, include_ui: bool = True) -> None:
    start_floci(include_ui=include_ui)

    if stack_outputs("CDKToolkit") is None:
        print("[dev-local] CDKToolkit is missing; bootstrapping Floci.", flush=True)
        bootstrap_local()
    else:
        print("[dev-local] Reusing the existing CDKToolkit stack.", flush=True)

    outputs = stack_outputs(LOCAL_STACK_NAME)
    local_stack_ready = outputs is not None and REQUIRED_LOCAL_OUTPUTS.issubset(outputs)
    if force_deploy or not local_stack_ready:
        reason = (
            "refresh requested"
            if force_deploy
            else "local application stack is missing"
        )
        print(f"[dev-local] Deploying to Floci because {reason}.", flush=True)
        deploy_local()
    else:
        export_web_config()

    seed_local_user()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare the Floci-backed development environment"
    )
    parser.add_argument(
        "--force-deploy",
        action="store_true",
        help="Deploy application changes even when the local stack already exists",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Prepare Floci and exit without starting the Vite development server",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        prepare_local(force_deploy=args.force_deploy, include_ui=True)
        if not args.prepare_only:
            print("[dev-local] Starting the Vite development server.", flush=True)
            start_web()
    except subprocess.CalledProcessError as error:
        return error.returncode or 1
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
