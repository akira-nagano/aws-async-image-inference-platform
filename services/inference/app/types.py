from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import TypedDict


@dataclass(frozen=True)
class Prediction:
    rank: int
    product_code: str
    confidence: float
    product_name: str | None = None
    brand: str | None = None

    def to_api(self) -> dict[str, object]:
        data = asdict(self)
        result: dict[str, object] = {
            "rank": data["rank"],
            "productCode": data["product_code"],
            "confidence": data["confidence"],
        }
        if data["product_name"] is not None:
            result["productName"] = data["product_name"]
        if data["brand"] is not None:
            result["brand"] = data["brand"]
        return result


class InferenceEvent(TypedDict):
    jobId: str
    userId: str
    objectKey: str
