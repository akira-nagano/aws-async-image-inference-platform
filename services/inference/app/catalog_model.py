from __future__ import annotations

import math
from typing import Protocol

from .catalog_index import CatalogIndex
from .types import Prediction


class ImageEncoder(Protocol):
    def encode(self, image_bytes: bytes) -> list[float]: ...


def _normalized(vector: list[float], dimension: int) -> tuple[float, ...]:
    if len(vector) != dimension:
        raise ValueError(f"Image embedding must have {dimension} elements")
    if not all(math.isfinite(value) for value in vector):
        raise ValueError("Image embedding must contain only finite values")
    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        raise ValueError("Image embedding norm must be greater than zero")
    return tuple(value / norm for value in vector)


class CatalogRetrievalModelAdapter:
    def __init__(
        self,
        encoder: ImageEncoder,
        catalog: CatalogIndex,
        max_predictions: int = 3,
    ) -> None:
        if max_predictions <= 0:
            raise ValueError("max_predictions must be positive")
        self._encoder = encoder
        self._catalog = catalog
        self._max_predictions = max_predictions

    @property
    def version(self) -> str:
        return self._catalog.model_version

    def predict(self, image_bytes: bytes) -> list[Prediction]:
        query = _normalized(
            self._encoder.encode(image_bytes),
            self._catalog.embedding_dimension,
        )
        scores: dict[str, float] = {}
        for reference in self._catalog.references:
            score = sum(
                query_value * reference_value
                for query_value, reference_value in zip(
                    query,
                    reference.embedding,
                    strict=True,
                )
            )
            scores[reference.product_code] = max(
                score,
                scores.get(reference.product_code, -1.0),
            )

        candidates = [
            (product_code, max(0.0, min(1.0, score)))
            for product_code, score in scores.items()
            if score >= self._catalog.threshold
        ]
        candidates.sort(key=lambda candidate: (-candidate[1], candidate[0]))

        predictions: list[Prediction] = []
        for rank, (product_code, score) in enumerate(
            candidates[: self._max_predictions],
            start=1,
        ):
            product = self._catalog.products[product_code]
            predictions.append(
                Prediction(
                    rank=rank,
                    product_code=product.product_code,
                    confidence=round(score, 6),
                    product_name=product.product_name,
                    brand=product.brand,
                )
            )
        return predictions
