#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
import tempfile

from local.dev_local import ROOT, prepare_local, run_checked


def show_floci_logs() -> None:
    subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            "local/compose.yaml",
            "--profile",
            "dev",
            "logs",
            "--no-color",
        ],
        cwd=ROOT,
        check=False,
    )


def stop_floci() -> None:
    run_checked([sys.executable, "./local/stop-floci.py"])


def main() -> int:
    result = 0
    previous_data_dir = os.environ.get("FLOCI_DATA_DIR")
    with tempfile.TemporaryDirectory(prefix=".e2e-data-", dir=ROOT / "local") as data_dir:
        os.environ["FLOCI_DATA_DIR"] = data_dir
        try:
            # A clean data directory guarantees that E2E validates the current
            # source tree without deleting the persistent development state.
            prepare_local(force_deploy=False, include_ui=False)
            run_checked(["bash", "./local/smoke-test.sh"])
            run_checked([sys.executable, "./local/run-integration.py"])
        except subprocess.CalledProcessError as error:
            result = error.returncode or 1
            show_floci_logs()
        except KeyboardInterrupt:
            result = 130
        finally:
            try:
                stop_floci()
            except subprocess.CalledProcessError as error:
                if result == 0:
                    result = error.returncode or 1
                else:
                    print(
                        "[e2e-local] Floci cleanup also failed after the primary error.",
                        file=sys.stderr,
                        flush=True,
                    )
            finally:
                if previous_data_dir is None:
                    os.environ.pop("FLOCI_DATA_DIR", None)
                else:
                    os.environ["FLOCI_DATA_DIR"] = previous_data_dir
    return result


if __name__ == "__main__":
    raise SystemExit(main())
