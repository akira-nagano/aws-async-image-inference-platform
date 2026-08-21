import json
from pathlib import Path

import pytest

from app.catalog_index import load_catalog_index
from app.catalog_model import CatalogRetrievalModelAdapter


class FakeEncoder:
    def __init__(self, embedding: list[float]) -> None:
        self._embedding = embedding

    def encode(self, _image_bytes: bytes) -> list[float]:
        return self._embedding


def write_index(
    path: Path,
    *,
    threshold: float = 0.5,
    references: list[dict[str, object]] | None = None,
) -> Path:
    content = {
        "schemaVersion": 1,
        "modelVersion": "catalog-test-001",
        "model": {
            "id": "test/encoder",
            "revision": "revision-1",
            "embeddingDimension": 2,
        },
        "threshold": threshold,
        "products": [
            {
                "productCode": "MODEL-A",
                "productName": "赤い商品",
                "brand": "Example",
            },
            {
                "productCode": "MODEL-B",
                "productName": "青い商品",
                "brand": None,
            },
        ],
        "references": references
        or [
            {
                "productCode": "MODEL-A",
                "referenceId": "MODEL-A#1",
                "embedding": [1.0, 0.0],
            },
            {
                "productCode": "MODEL-A",
                "referenceId": "MODEL-A#2",
                "embedding": [0.8, 0.6],
            },
            {
                "productCode": "MODEL-B",
                "referenceId": "MODEL-B#1",
                "embedding": [0.0, 1.0],
            },
        ],
    }
    path.write_text(json.dumps(content), encoding="utf-8")
    return path


def test_catalog_search_ranks_products_and_keeps_metadata(tmp_path: Path) -> None:
    catalog = load_catalog_index(write_index(tmp_path / "catalog.json"))
    adapter = CatalogRetrievalModelAdapter(FakeEncoder([10.0, 0.0]), catalog)

    predictions = adapter.predict(b"image")

    assert [prediction.product_code for prediction in predictions] == ["MODEL-A"]
    assert predictions[0].rank == 1
    assert predictions[0].confidence == 1.0
    assert predictions[0].product_name == "赤い商品"
    assert predictions[0].brand == "Example"
    assert predictions[0].to_api() == {
        "rank": 1,
        "productCode": "MODEL-A",
        "confidence": 1.0,
        "productName": "赤い商品",
        "brand": "Example",
    }


def test_catalog_search_uses_best_reference_per_product(tmp_path: Path) -> None:
    catalog = load_catalog_index(write_index(tmp_path / "catalog.json", threshold=0.0))
    adapter = CatalogRetrievalModelAdapter(FakeEncoder([0.8, 0.6]), catalog)

    predictions = adapter.predict(b"image")

    assert [prediction.product_code for prediction in predictions] == ["MODEL-A", "MODEL-B"]
    assert predictions[0].confidence == 1.0
    assert predictions[1].confidence == 0.6


def test_catalog_search_returns_no_match_below_threshold(tmp_path: Path) -> None:
    catalog = load_catalog_index(write_index(tmp_path / "catalog.json", threshold=0.9))
    adapter = CatalogRetrievalModelAdapter(FakeEncoder([-1.0, 0.0]), catalog)

    assert adapter.predict(b"unknown-image") == []


@pytest.mark.parametrize(
    ("references", "message"),
    [
        (
            [
                {
                    "productCode": "MISSING",
                    "referenceId": "missing#1",
                    "embedding": [1.0, 0.0],
                }
            ],
            "unknown productCode",
        ),
        (
            [
                {
                    "productCode": "MODEL-A",
                    "referenceId": "MODEL-A#1",
                    "embedding": [2.0, 0.0],
                },
                {
                    "productCode": "MODEL-B",
                    "referenceId": "MODEL-B#1",
                    "embedding": [0.0, 1.0],
                },
            ],
            "L2-normalized",
        ),
    ],
)
def test_catalog_loader_rejects_invalid_references(
    tmp_path: Path,
    references: list[dict[str, object]],
    message: str,
) -> None:
    path = write_index(tmp_path / "catalog.json", references=references)

    with pytest.raises(ValueError, match=message):
        load_catalog_index(path)
