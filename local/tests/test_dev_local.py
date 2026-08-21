from __future__ import annotations

import importlib.util
import pathlib
from argparse import Namespace
from types import ModuleType

import pytest


SCRIPT_PATH = pathlib.Path(__file__).resolve().parents[1] / "dev_local.py"


def load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("dev_local", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_uses_the_generic_local_stack_name() -> None:
    module = load_script()
    assert module.LOCAL_STACK_NAME == "ImgFlow-local"


def test_bootstrap_retries_transient_floci_connection_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_script()
    attempts: list[tuple[tuple[str, ...], dict[str, str] | None]] = []
    waits: list[int] = []

    def flaky_run(
        command: list[str],
        *,
        env: dict[str, str] | None = None,
    ) -> None:
        attempts.append((tuple(command), env))
        if len(attempts) < 3:
            raise module.subprocess.CalledProcessError(1, command)

    monkeypatch.setattr(module, "run_checked", flaky_run)
    monkeypatch.setattr(module.time, "sleep", lambda seconds: waits.append(seconds))

    module.bootstrap_local()

    assert len(attempts) == 3
    assert all(attempt[0][-1] == "bootstrap:local" for attempt in attempts)
    assert waits == [2, 2]


def test_prepare_bootstraps_and_deploys_a_new_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_script()
    events: list[str] = []
    exports: list[bool] = []

    monkeypatch.setattr(
        module,
        "start_floci",
        lambda *, include_ui: events.append(f"start:{include_ui}"),
    )
    monkeypatch.setattr(module, "bootstrap_local", lambda: events.append("bootstrap"))
    monkeypatch.setattr(module, "deploy_local", lambda: events.append("deploy"))
    monkeypatch.setattr(module, "seed_local_user", lambda: events.append("seed"))
    monkeypatch.setattr(module, "stack_outputs", lambda _name: None)
    monkeypatch.setattr(module, "export_web_config", lambda: exports.append(True))

    module.prepare_local(force_deploy=False)

    assert events == ["start:True", "bootstrap", "deploy", "seed"]
    assert exports == []


def test_prepare_reuses_existing_stacks(monkeypatch: pytest.MonkeyPatch) -> None:
    module = load_script()
    events: list[str] = []
    exports: list[bool] = []

    def existing_outputs(stack_name: str) -> dict[str, object]:
        if stack_name == "CDKToolkit":
            return {}
        return {key: "value" for key in module.REQUIRED_LOCAL_OUTPUTS}

    monkeypatch.setattr(
        module,
        "start_floci",
        lambda *, include_ui: events.append(f"start:{include_ui}"),
    )
    monkeypatch.setattr(module, "bootstrap_local", lambda: events.append("bootstrap"))
    monkeypatch.setattr(module, "deploy_local", lambda: events.append("deploy"))
    monkeypatch.setattr(module, "seed_local_user", lambda: events.append("seed"))
    monkeypatch.setattr(module, "stack_outputs", existing_outputs)
    monkeypatch.setattr(module, "export_web_config", lambda: exports.append(True))

    module.prepare_local(force_deploy=False)

    assert events == ["start:True", "seed"]
    assert exports == [True]


def test_force_deploy_refreshes_an_existing_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_script()
    events: list[str] = []
    exports: list[bool] = []

    monkeypatch.setattr(
        module,
        "start_floci",
        lambda *, include_ui: events.append(f"start:{include_ui}"),
    )
    monkeypatch.setattr(module, "bootstrap_local", lambda: events.append("bootstrap"))
    monkeypatch.setattr(module, "deploy_local", lambda: events.append("deploy"))
    monkeypatch.setattr(module, "seed_local_user", lambda: events.append("seed"))
    monkeypatch.setattr(
        module,
        "stack_outputs",
        lambda _name: {key: "value" for key in module.REQUIRED_LOCAL_OUTPUTS},
    )
    monkeypatch.setattr(module, "export_web_config", lambda: exports.append(True))

    module.prepare_local(force_deploy=True)

    assert events == ["start:True", "deploy", "seed"]
    assert exports == []


def test_main_starts_vite_after_preparing_floci(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = load_script()
    prepared: list[tuple[bool, bool]] = []
    web_started: list[bool] = []

    monkeypatch.setattr(
        module,
        "parse_args",
        lambda: Namespace(force_deploy=False, prepare_only=False),
    )
    monkeypatch.setattr(
        module,
        "prepare_local",
        lambda *, force_deploy, include_ui: prepared.append((force_deploy, include_ui)),
    )
    monkeypatch.setattr(module, "start_web", lambda: web_started.append(True))

    assert module.main() == 0
    assert prepared == [(False, True)]
    assert web_started == [True]
