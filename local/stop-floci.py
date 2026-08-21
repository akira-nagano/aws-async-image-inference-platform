#!/usr/bin/env python3
from __future__ import annotations

import pathlib
import subprocess


root = pathlib.Path(__file__).resolve().parents[1]


def container_ids(name_filter: str) -> list[str]:
    result = subprocess.check_output(
        ["docker", "ps", "-aq", "--filter", f"name={name_filter}"],
        cwd=root,
        text=True,
    )
    return [line for line in result.splitlines() if line]


targets = [
    *container_ids("^/floci-ImgFlow-local-"),
    *container_ids("^/floci-ecr-registry$"),
]
if targets:
    subprocess.run(["docker", "rm", "-f", *targets], cwd=root, check=True)
subprocess.run(
    ["docker", "compose", "-f", "local/compose.yaml", "--profile", "dev", "down"],
    cwd=root,
    check=True,
)
