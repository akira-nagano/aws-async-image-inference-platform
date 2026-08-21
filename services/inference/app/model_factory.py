from __future__ import annotations

import os

from .catalog_index import load_catalog_index
from .catalog_model import CatalogRetrievalModelAdapter
from .dinov2_encoder import Dinov2Encoder
from .model_adapter import ModelAdapter
from .real_model import RealModelAdapter
from .stub_model import StubModelAdapter


def create_model() -> ModelAdapter:
    profile = os.environ.get("MODEL_PROFILE", "stub").lower()
    if profile == "stub":
        return StubModelAdapter()
    if profile == "catalog":
        catalog = load_catalog_index(
            os.environ.get("CATALOG_INDEX_PATH", "/opt/model/catalog-index.json")
        )
        encoder = Dinov2Encoder(
            os.environ.get("DINO_MODEL_PATH", "/opt/model/dinov2-small")
        )
        return CatalogRetrievalModelAdapter(encoder, catalog)
    if profile == "real":
        return RealModelAdapter(os.environ.get("MODEL_PATH", "/opt/model/model.bin"))
    raise ValueError(f"Unsupported MODEL_PROFILE: {profile}")
