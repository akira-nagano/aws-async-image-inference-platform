from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

SCHEMA_VERSION = 1
MAX_PRODUCT_CODE_LENGTH = 128
MAX_PRODUCT_NAME_LENGTH = 256
MAX_BRAND_LENGTH = 128
NORMALIZATION_TOLERANCE = 1e-3


@dataclass(frozen=True)
class CatalogProduct:
    product_code: str
    product_name: str
    brand: str | None


@dataclass(frozen=True)
class CatalogReference:
    product_code: str
    reference_id: str
    embedding: tuple[float, ...]


@dataclass(frozen=True)
class CatalogIndex:
    model_version: str
    model_id: str
    model_revision: str
    embedding_dimension: int
    threshold: float
    products: dict[str, CatalogProduct]
    references: tuple[CatalogReference, ...]


def _mapping(value: object, field: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{field} must be an object")
    return cast(dict[str, Any], value)


def _list(value: object, field: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    return value


def _string(value: object, field: str, max_length: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    resolved = value.strip()
    if len(resolved) > max_length:
        raise ValueError(f"{field} must be at most {max_length} characters")
    return resolved


def _optional_string(value: object, field: str, max_length: int) -> str | None:
    if value is None:
        return None
    return _string(value, field, max_length)


def _number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{field} must be a number")
    resolved = float(value)
    if not math.isfinite(resolved):
        raise ValueError(f"{field} must be finite")
    return resolved


def _embedding(value: object, dimension: int, field: str) -> tuple[float, ...]:
    raw = _list(value, field)
    if len(raw) != dimension:
        raise ValueError(f"{field} must have {dimension} elements")
    resolved = tuple(_number(item, f"{field}[]") for item in raw)
    norm = math.sqrt(sum(item * item for item in resolved))
    if abs(norm - 1.0) > NORMALIZATION_TOLERANCE:
        raise ValueError(f"{field} must be L2-normalized")
    return resolved


def load_catalog_index(path: str | Path) -> CatalogIndex:
    index_path = Path(path)
    try:
        raw = json.loads(index_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Catalog index is not valid JSON: {index_path}") from error

    root = _mapping(raw, "catalog")
    if root.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError(f"catalog.schemaVersion must be {SCHEMA_VERSION}")

    model_version = _string(root.get("modelVersion"), "catalog.modelVersion", 128)
    model = _mapping(root.get("model"), "catalog.model")
    model_id = _string(model.get("id"), "catalog.model.id", 256)
    model_revision = _string(model.get("revision"), "catalog.model.revision", 128)
    dimension_value = model.get("embeddingDimension")
    if isinstance(dimension_value, bool) or not isinstance(dimension_value, int):
        raise ValueError("catalog.model.embeddingDimension must be an integer")
    if dimension_value <= 0:
        raise ValueError("catalog.model.embeddingDimension must be positive")
    threshold = _number(root.get("threshold"), "catalog.threshold")
    if not 0.0 <= threshold <= 1.0:
        raise ValueError("catalog.threshold must be between 0 and 1")

    products: dict[str, CatalogProduct] = {}
    for index, product_value in enumerate(_list(root.get("products"), "catalog.products")):
        product = _mapping(product_value, f"catalog.products[{index}]")
        product_code = _string(
            product.get("productCode"),
            f"catalog.products[{index}].productCode",
            MAX_PRODUCT_CODE_LENGTH,
        )
        if product_code in products:
            raise ValueError(f"Duplicate productCode: {product_code}")
        products[product_code] = CatalogProduct(
            product_code=product_code,
            product_name=_string(
                product.get("productName"),
                f"catalog.products[{index}].productName",
                MAX_PRODUCT_NAME_LENGTH,
            ),
            brand=_optional_string(
                product.get("brand"),
                f"catalog.products[{index}].brand",
                MAX_BRAND_LENGTH,
            ),
        )
    if not products:
        raise ValueError("catalog.products must not be empty")

    references: list[CatalogReference] = []
    referenced_products: set[str] = set()
    reference_ids: set[str] = set()
    for index, reference_value in enumerate(_list(root.get("references"), "catalog.references")):
        reference = _mapping(reference_value, f"catalog.references[{index}]")
        product_code = _string(
            reference.get("productCode"),
            f"catalog.references[{index}].productCode",
            MAX_PRODUCT_CODE_LENGTH,
        )
        if product_code not in products:
            raise ValueError(f"Reference uses unknown productCode: {product_code}")
        reference_id = _string(
            reference.get("referenceId"),
            f"catalog.references[{index}].referenceId",
            256,
        )
        if reference_id in reference_ids:
            raise ValueError(f"Duplicate referenceId: {reference_id}")
        reference_ids.add(reference_id)
        referenced_products.add(product_code)
        references.append(
            CatalogReference(
                product_code=product_code,
                reference_id=reference_id,
                embedding=_embedding(
                    reference.get("embedding"),
                    dimension_value,
                    f"catalog.references[{index}].embedding",
                ),
            )
        )
    if not references:
        raise ValueError("catalog.references must not be empty")
    products_without_references = set(products) - referenced_products
    if products_without_references:
        missing = ", ".join(sorted(products_without_references))
        raise ValueError(f"Products without references: {missing}")

    return CatalogIndex(
        model_version=model_version,
        model_id=model_id,
        model_revision=model_revision,
        embedding_dimension=dimension_value,
        threshold=threshold,
        products=products,
        references=tuple(references),
    )
