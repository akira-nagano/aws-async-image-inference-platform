from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from dataclasses import replace
from pathlib import Path
from typing import Any, cast

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
INFERENCE_ROOT = REPOSITORY_ROOT / "services" / "inference"
sys.path.insert(0, str(INFERENCE_ROOT))

from app.catalog_index import load_catalog_index  # noqa: E402
from app.catalog_model import CatalogRetrievalModelAdapter  # noqa: E402
from app.dinov2_encoder import Dinov2Encoder  # noqa: E402


class FixedEmbeddingEncoder:
    def __init__(self, embedding: list[float]) -> None:
        self._embedding = embedding

    def encode(self, image_bytes: bytes) -> list[float]:
        del image_bytes
        return self._embedding


def mapping(value: object, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return cast(dict[str, Any], value)


def array(value: object, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    return value


def required_string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value.strip()


def optional_string(value: object, field: str) -> str | None:
    if value is None:
        return None
    return required_string(value, field)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a normalized DINOv2 product catalog index and evaluate query images."
    )
    parser.add_argument("source", type=Path, help="catalog-source.json")
    parser.add_argument(
        "--model-directory",
        type=Path,
        default=INFERENCE_ROOT / "model-runtime" / "dinov2-small",
    )
    parser.add_argument(
        "--model-manifest",
        type=Path,
        default=INFERENCE_ROOT / "model-runtime" / "dinov2-manifest.json",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=INFERENCE_ROOT / "model-runtime" / "catalog-index.json",
    )
    parser.add_argument("--threshold", type=float, default=0.45)
    parser.add_argument(
        "--unknown-image",
        action="append",
        type=Path,
        default=[],
        help="Image expected to be rejected by the configured threshold. May be repeated.",
    )
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return mapping(json.loads(path.read_text(encoding="utf-8")), str(path))


def resolve_images(
    manifest_directory: Path,
    value: object,
    field: str,
) -> list[Path]:
    resolved: list[Path] = []
    for index, item in enumerate(array(value, field)):
        relative_path = Path(required_string(item, f"{field}[{index}]"))
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError(f"{field}[{index}] must be a safe relative path")
        path = (manifest_directory / relative_path).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Reference image not found: {path}")
        resolved.append(path)
    if not resolved:
        raise ValueError(f"{field} must not be empty")
    return resolved


def main() -> int:
    args = parse_args()
    if not 0.0 <= args.threshold <= 1.0:
        raise ValueError("threshold must be between 0 and 1")

    source_path: Path = args.source.resolve()
    source = load_json(source_path)
    if source.get("schemaVersion") != 1:
        raise ValueError("source.schemaVersion must be 1")
    model_manifest = load_json(args.model_manifest.resolve())
    model_id = required_string(model_manifest.get("modelId"), "model.modelId")
    model_revision = required_string(model_manifest.get("revision"), "model.revision")
    encoder = Dinov2Encoder(args.model_directory.resolve())

    product_rows: list[dict[str, object]] = []
    reference_rows: list[dict[str, object]] = []
    evaluation_rows: list[tuple[str, Path]] = []
    dimension: int | None = None
    manifest_directory = source_path.parent
    reference_content_digest = hashlib.sha256()

    products = array(source.get("products"), "source.products")
    for product_index, product_value in enumerate(products):
        product = mapping(product_value, f"source.products[{product_index}]")
        product_code = required_string(
            product.get("productCode"),
            f"source.products[{product_index}].productCode",
        )
        product_name = required_string(
            product.get("productName"),
            f"source.products[{product_index}].productName",
        )
        brand = optional_string(product.get("brand"), f"source.products[{product_index}].brand")
        product_row: dict[str, object] = {
            "productCode": product_code,
            "productName": product_name,
        }
        if brand is not None:
            product_row["brand"] = brand
        product_rows.append(product_row)

        reference_images = resolve_images(
            manifest_directory,
            product.get("referenceImages"),
            f"source.products[{product_index}].referenceImages",
        )
        for reference_index, image_path in enumerate(reference_images, start=1):
            image_bytes = image_path.read_bytes()
            reference_content_digest.update(product_code.encode())
            reference_content_digest.update(b"\0")
            reference_content_digest.update(str(reference_index).encode())
            reference_content_digest.update(b"\0")
            reference_content_digest.update(hashlib.sha256(image_bytes).digest())
            embedding = encoder.encode(image_bytes)
            if dimension is None:
                dimension = len(embedding)
            elif len(embedding) != dimension:
                raise ValueError("Encoder returned inconsistent embedding dimensions")
            reference_rows.append(
                {
                    "productCode": product_code,
                    "referenceId": f"{product_code}#{reference_index}",
                    "embedding": embedding,
                }
            )
            print(
                f"encoded reference {len(reference_rows)}: "
                f"{product_code} {image_path.name}"
            )

        query_value = product.get("queryImages")
        if query_value is not None:
            for query_path in resolve_images(
                manifest_directory,
                query_value,
                f"source.products[{product_index}].queryImages",
            ):
                evaluation_rows.append((product_code, query_path))

    if dimension is None:
        raise ValueError("No reference embeddings were generated")
    version_digest = hashlib.sha256()
    version_digest.update(source_path.read_bytes())
    version_digest.update(b"\0")
    version_digest.update(model_id.encode())
    version_digest.update(b"\0")
    version_digest.update(model_revision.encode())
    version_digest.update(b"\0")
    version_digest.update(format(args.threshold, ".12g").encode())
    version_digest.update(b"\0")
    version_digest.update(reference_content_digest.digest())
    source_digest = version_digest.hexdigest()[:12]
    index_document = {
        "schemaVersion": 1,
        "modelVersion": f"catalog-dinov2-small-{source_digest}",
        "model": {
            "id": model_id,
            "revision": model_revision,
            "embeddingDimension": dimension,
        },
        "threshold": args.threshold,
        "products": product_rows,
        "references": reference_rows,
    }

    output_path: Path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=output_path.parent,
        prefix=f".{output_path.name}.",
        suffix=".partial",
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)
        json.dump(index_document, temporary, ensure_ascii=False, separators=(",", ":"))
        temporary.write("\n")
    temporary_path.replace(output_path)

    catalog = load_catalog_index(output_path)
    retrieval_catalog = replace(catalog, threshold=0.0)
    accepted_correct = 0
    retrieval_correct = 0
    rejected = 0
    for expected_product_code, query_path in evaluation_rows:
        query_embedding = encoder.encode(query_path.read_bytes())
        fixed_encoder = FixedEmbeddingEncoder(query_embedding)
        predictions = CatalogRetrievalModelAdapter(fixed_encoder, catalog).predict(b"query")
        retrieval_predictions = CatalogRetrievalModelAdapter(
            fixed_encoder,
            retrieval_catalog,
        ).predict(b"query")
        actual_product_code = predictions[0].product_code if predictions else None
        retrieval_product_code = (
            retrieval_predictions[0].product_code if retrieval_predictions else None
        )
        retrieval_score = (
            retrieval_predictions[0].confidence if retrieval_predictions else None
        )
        accepted_correct += int(actual_product_code == expected_product_code)
        retrieval_correct += int(retrieval_product_code == expected_product_code)
        rejected += int(actual_product_code is None)
        print(
            f"query expected={expected_product_code} actual={actual_product_code} "
            f"retrieval={retrieval_product_code} score={retrieval_score} "
            f"image={query_path.name}"
        )
    if evaluation_rows:
        accepted_accuracy = accepted_correct / len(evaluation_rows)
        retrieval_accuracy = retrieval_correct / len(evaluation_rows)
        print(
            f"accepted top1 accuracy: {accepted_correct}/{len(evaluation_rows)} "
            f"({accepted_accuracy:.1%}), rejected={rejected}"
        )
        print(
            f"retrieval top1 accuracy: {retrieval_correct}/{len(evaluation_rows)} "
            f"({retrieval_accuracy:.1%})"
        )
    for unknown_image in args.unknown_image:
        unknown_path = unknown_image.resolve()
        if not unknown_path.is_file():
            raise FileNotFoundError(f"Unknown evaluation image not found: {unknown_path}")
        unknown_embedding = encoder.encode(unknown_path.read_bytes())
        fixed_encoder = FixedEmbeddingEncoder(unknown_embedding)
        predictions = CatalogRetrievalModelAdapter(fixed_encoder, catalog).predict(b"unknown")
        retrieval_predictions = CatalogRetrievalModelAdapter(
            fixed_encoder,
            retrieval_catalog,
        ).predict(b"unknown")
        actual_product_code = predictions[0].product_code if predictions else None
        retrieval_product_code = (
            retrieval_predictions[0].product_code if retrieval_predictions else None
        )
        retrieval_score = (
            retrieval_predictions[0].confidence if retrieval_predictions else None
        )
        print(
            f"unknown expected=None actual={actual_product_code} "
            f"retrieval={retrieval_product_code} score={retrieval_score} "
            f"image={unknown_path.name}"
        )
    print(f"wrote {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
