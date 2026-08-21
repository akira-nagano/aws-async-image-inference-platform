from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TARGETS = (
    "node_modules",
    "apps/web/dist",
    "services/api/dist",
    "infra/cdk/dist",
    "infra/cdk/cdk.out",
    "coverage",
    ".pytest_cache",
)


def main() -> None:
    for relative_path in TARGETS:
        target = (ROOT / relative_path).resolve()
        if ROOT not in target.parents:
            raise RuntimeError(f"Refusing to remove path outside repository: {target}")
        if target.is_dir():
            shutil.rmtree(target)
        elif target.exists():
            target.unlink()


if __name__ == "__main__":
    main()
