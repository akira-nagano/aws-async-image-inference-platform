from app.stub_model import StubModelAdapter


def test_stub_is_deterministic() -> None:
    adapter = StubModelAdapter()
    first = adapter.predict(b"same-image")
    second = adapter.predict(b"same-image")
    assert first == second
    assert len(first) == 3
    assert [item.rank for item in first] == [1, 2, 3]
    assert all(item.product_code.startswith("DEMO-") for item in first)
    assert all(0 < item.confidence <= 1 for item in first)
