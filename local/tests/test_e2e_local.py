from __future__ import annotations

import importlib.util
import pathlib
import subprocess
import sys
from types import ModuleType

import pytest


SCRIPT_PATH = pathlib.Path(__file__).resolve().parents[1] / "e2e_local.py"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("e2e_local", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_runs_full_e2e_without_ui_and_stops_floci(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_script()
    events: list[object] = []

    monkeypatch.setattr(
        module,
        "prepare_local",
        lambda *, force_deploy, include_ui: events.append(
            ("prepare", force_deploy, include_ui)
        ),
    )
    monkeypatch.setattr(
        module,
        "run_checked",
        lambda command: events.append(tuple(command)),
    )
    monkeypatch.setattr(module, "stop_floci", lambda: events.append("stop"))

    assert module.main() == 0
    assert events == [
        ("prepare", False, False),
        ("bash", "./local/smoke-test.sh"),
        (sys.executable, "./local/run-integration.py"),
        "stop",
    ]


def test_captures_logs_and_stops_floci_after_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_script()
    events: list[str] = []

    def fail_prepare(*, force_deploy: bool, include_ui: bool) -> None:
        assert not force_deploy
        assert not include_ui
        raise subprocess.CalledProcessError(7, "deploy")

    monkeypatch.setattr(module, "prepare_local", fail_prepare)
    monkeypatch.setattr(module, "show_floci_logs", lambda: events.append("logs"))
    monkeypatch.setattr(module, "stop_floci", lambda: events.append("stop"))

    assert module.main() == 7
    assert events == ["logs", "stop"]
