#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

stack_name = os.environ.get("STACK_NAME", "ImgFlow-local")
root = pathlib.Path(__file__).resolve().parents[1]
aws_cli = os.environ.get(
    "AWS_CLI_COMMAND",
    str(root / "scripts/aws.cmd") if os.name == "nt" else "aws",
)
runner = os.environ.get("AWS_CLI_RUNNER", os.environ.get("COMSPEC") if os.name == "nt" else None)
command = [
    *([runner, "/d", "/c"] if runner else []),
    aws_cli,
    "--region",
    os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-1"),
    "--no-sign-request",
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stack_name,
    "--output",
    "json",
]
endpoint = os.environ.get("AWS_ENDPOINT_URL")
if endpoint:
    command.extend(["--endpoint-url", endpoint])
response = json.loads(subprocess.check_output(command, text=True))
outputs = {
    item["OutputKey"]: item["OutputValue"]
    for item in response["Stacks"][0].get("Outputs", [])
}
if len(sys.argv) == 2:
    print(outputs[sys.argv[1]])
else:
    print(json.dumps(outputs, ensure_ascii=False, indent=2))
