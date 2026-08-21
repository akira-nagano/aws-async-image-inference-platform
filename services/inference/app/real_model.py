from __future__ import annotations

from pathlib import Path

from .types import Prediction


class RealModelAdapter:
    """Integration point for the real model. Do not guess its framework or format."""

    def __init__(self, model_path: str) -> None:
        self._model_path = Path(model_path)
        if not self._model_path.exists():
            raise FileNotFoundError(f"Model file not found: {self._model_path}")
        raise NotImplementedError(
            "The real model runtime is not supplied. Implement after model format, dependencies, "
            "input preprocessing, and label mapping are confirmed."
        )

    @property
    def version(self) -> str:
        return "real-unimplemented"

    def predict(self, image_bytes: bytes) -> list[Prediction]:
        raise NotImplementedError
