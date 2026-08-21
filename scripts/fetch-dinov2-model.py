from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.request import Request, urlopen

MODEL_ID = "facebook/dinov2-small"
MODEL_REVISION = "ed25f3a31f01632728cabb09d1542f84ab7b0056"
MODEL_BASE_URL = f"https://huggingface.co/{MODEL_ID}/resolve/{MODEL_REVISION}"
BUFFER_SIZE = 1024 * 1024


@dataclass(frozen=True)
class ModelFile:
    name: str
    size: int
    sha256: str


MODEL_FILES = (
    ModelFile(
        name="config.json",
        size=547,
        sha256="1809f83e3bdb1609a501a610ad4a742f4fd8ae44d72ca4aa0df52d1f2ac8628d",
    ),
    ModelFile(
        name="preprocessor_config.json",
        size=436,
        sha256="14e780d86fa1861f8751f868d7f45425b5feb55c38ca26f152ca5097ab30f828",
    ),
    ModelFile(
        name="model.safetensors",
        size=88_249_960,
        sha256="ae1e99fcefd534ed978cdeb8326f08030c96e28b7a81ffcbc98a857c84d14be1",
    ),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(BUFFER_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file(path: Path, expected: ModelFile) -> bool:
    return (
        path.is_file()
        and path.stat().st_size == expected.size
        and sha256_file(path) == expected.sha256
    )


def download_file(target: Path, expected: ModelFile) -> None:
    request = Request(
        f"{MODEL_BASE_URL}/{expected.name}",
        headers={"User-Agent": "imgflow-catalog-poc/1.0"},
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".partial",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            with urlopen(request, timeout=60) as response:
                shutil.copyfileobj(response, temporary, BUFFER_SIZE)
    except BaseException:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise

    assert temporary_path is not None
    if not verify_file(temporary_path, expected):
        temporary_path.unlink(missing_ok=True)
        raise ValueError(f"Downloaded file failed verification: {expected.name}")
    temporary_path.replace(target)


def parse_args() -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[1]
    default_output = repository_root / "services" / "inference" / "model-runtime"
    parser = argparse.ArgumentParser(
        description="Fetch the pinned DINOv2-small files and verify their SHA-256 digests."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=default_output,
        help="Model runtime directory. Defaults to services/inference/model-runtime.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_directory: Path = args.output.resolve()
    model_directory = output_directory / "dinov2-small"

    for expected in MODEL_FILES:
        target = model_directory / expected.name
        if verify_file(target, expected):
            print(f"verified {target}")
            continue
        print(f"downloading {expected.name} ({expected.size} bytes)")
        download_file(target, expected)
        print(f"verified {target}")

    manifest = {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "revision": MODEL_REVISION,
        "license": "Apache-2.0",
        "source": f"https://huggingface.co/{MODEL_ID}/tree/{MODEL_REVISION}",
        "files": [
            {"name": item.name, "sizeBytes": item.size, "sha256": item.sha256}
            for item in MODEL_FILES
        ],
    }
    manifest_path = output_directory / "dinov2-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
