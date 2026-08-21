from __future__ import annotations

import hashlib

from .types import Prediction


class StubModelAdapter:
    """Deterministic stub used until the real model and runtime are supplied."""

    @property
    def version(self) -> str:
        return "stub-001"

    def predict(self, image_bytes: bytes) -> list[Prediction]:
        digest = hashlib.sha256(image_bytes).digest()
        raw = [digest[0] + 1, digest[1] + 1, digest[2] + 1]
        total = float(sum(raw))
        scores = sorted((value / total for value in raw), reverse=True)
        codes = [
            f"DEMO-{int.from_bytes(digest[3:5], 'big') % 1000:03d}",
            f"DEMO-{int.from_bytes(digest[5:7], 'big') % 1000:03d}",
            f"DEMO-{int.from_bytes(digest[7:9], 'big') % 1000:03d}",
        ]
        return [
            Prediction(rank=index + 1, product_code=codes[index], confidence=round(score, 6))
            for index, score in enumerate(scores)
        ]
