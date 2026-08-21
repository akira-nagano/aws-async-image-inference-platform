import pytest

from app import model_factory
from app.catalog_index import CatalogIndex, CatalogProduct, CatalogReference
from app.catalog_model import CatalogRetrievalModelAdapter
from app.model_factory import create_model
from app.stub_model import StubModelAdapter


def test_factory_defaults_to_stub(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MODEL_PROFILE", raising=False)
    assert isinstance(create_model(), StubModelAdapter)


class FakeEncoder:
    def __init__(self, model_directory: str) -> None:
        self.model_directory = model_directory

    def encode(self, image_bytes: bytes) -> list[float]:
        del image_bytes
        return [1.0, 0.0]


def test_factory_creates_the_catalog_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    catalog = CatalogIndex(
        model_version="catalog-test",
        model_id="test/model",
        model_revision="revision",
        embedding_dimension=2,
        threshold=0.5,
        products={
            "MODEL-001": CatalogProduct("MODEL-001", "Example product", "Example brand")
        },
        references=(CatalogReference("MODEL-001", "MODEL-001#1", (1.0, 0.0)),),
    )
    monkeypatch.setenv("MODEL_PROFILE", "catalog")
    monkeypatch.setenv("DINO_MODEL_PATH", "model-directory")
    monkeypatch.setattr(model_factory, "load_catalog_index", lambda _path: catalog)
    monkeypatch.setattr(model_factory, "Dinov2Encoder", FakeEncoder)

    adapter = create_model()

    assert isinstance(adapter, CatalogRetrievalModelAdapter)
    assert adapter.predict(b"image")[0].product_code == "MODEL-001"
