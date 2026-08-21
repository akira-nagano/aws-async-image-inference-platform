#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate an external model against its manifest")
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--model-dir", required=True, type=Path)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    file_name = manifest.get("fileName")
    if not isinstance(file_name, str) or not file_name:
        raise SystemExit("manifest.fileName is required")
    model_path = args.model_dir / file_name
    if not model_path.is_file():
        raise SystemExit(f"model file not found: {model_path}")

    actual_size = model_path.stat().st_size
    expected_size = manifest.get("sizeBytes")
    if isinstance(expected_size, int) and actual_size != expected_size:
        raise SystemExit(f"size mismatch: expected={expected_size} actual={actual_size}")

    actual_sha = sha256_file(model_path)
    expected_sha = manifest.get("sha256")
    if isinstance(expected_sha, str) and expected_sha and actual_sha.lower() != expected_sha.lower():
        raise SystemExit(f"sha256 mismatch: expected={expected_sha} actual={actual_sha}")

    print(json.dumps({"file": str(model_path), "sizeBytes": actual_size, "sha256": actual_sha}, indent=2))


if __name__ == "__main__":
    main()
