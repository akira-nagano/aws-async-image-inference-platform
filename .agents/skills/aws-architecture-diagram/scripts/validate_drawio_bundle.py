#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["defusedxml>=0.7.1"]
# ///
"""Post-process, validate, and create a preview URL for a draw.io file."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def run_step(script: Path, target: Path) -> None:
    result = subprocess.run(
        [sys.executable, str(script), str(target)],
        capture_output=True,
        check=False,
        text=True,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: validate_drawio_bundle.py <file.drawio>", file=sys.stderr)
        raise SystemExit(2)

    target = Path(sys.argv[1]).resolve()
    if not target.is_file() or not str(target).endswith((".drawio", ".drawio.xml")):
        print(f"Not a draw.io file: {target}", file=sys.stderr)
        raise SystemExit(2)

    script_dir = Path(__file__).resolve().parent
    library_dir = script_dir / "lib"
    run_step(library_dir / "post_process_drawio.py", target)
    run_step(library_dir / "validate_drawio.py", target)
    run_step(library_dir / "drawio_url.py", target)


if __name__ == "__main__":
    main()