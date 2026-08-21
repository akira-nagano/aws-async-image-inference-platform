from __future__ import annotations

from typing import Protocol

from .types import Prediction


class ModelAdapter(Protocol):
    @property
    def version(self) -> str: ...

    def predict(self, image_bytes: bytes) -> list[Prediction]: ...
