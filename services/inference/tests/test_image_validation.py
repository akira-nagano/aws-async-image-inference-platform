from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from app.image_validation import validate_image


def image_bytes(image_format: str, size: tuple[int, int] = (8, 8)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, color=(32, 64, 128)).save(output, format=image_format)
    return output.getvalue()


@pytest.mark.parametrize("image_format", ["JPEG", "PNG"])
def test_accepts_decodable_jpeg_and_png(image_format: str) -> None:
    validate_image(image_bytes(image_format))


def test_rejects_declared_image_bytes_that_are_not_an_image() -> None:
    with pytest.raises(ValueError, match="cannot be decoded"):
        validate_image(b"not-an-image")


def test_rejects_an_unsupported_decodable_format() -> None:
    with pytest.raises(ValueError, match="JPEG or PNG"):
        validate_image(image_bytes("GIF"))


def test_rejects_dimensions_above_the_decode_contract() -> None:
    with pytest.raises(ValueError, match="dimensions exceed"):
        validate_image(image_bytes("PNG", (4097, 1)))


def test_rejects_a_truncated_image() -> None:
    valid = image_bytes("PNG")
    with pytest.raises(ValueError, match="cannot be decoded"):
        validate_image(valid[: len(valid) // 2])
