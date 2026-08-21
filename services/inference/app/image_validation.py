from __future__ import annotations

import warnings
from io import BytesIO

from PIL import Image, UnidentifiedImageError

ALLOWED_IMAGE_FORMATS = frozenset({"JPEG", "PNG"})
MAX_IMAGE_DIMENSION = 4096
MAX_IMAGE_PIXELS = 16_777_216


def validate_image(image_bytes: bytes) -> None:
    if not image_bytes:
        raise ValueError("Input image is empty")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(image_bytes)) as image:
                if image.format not in ALLOWED_IMAGE_FORMATS:
                    raise ValueError("Input image format must be JPEG or PNG")
                width, height = image.size
                if width <= 0 or height <= 0:
                    raise ValueError("Input image dimensions must be positive")
                if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                    raise ValueError("Input image dimensions exceed the allowed maximum")
                if width * height > MAX_IMAGE_PIXELS:
                    raise ValueError("Input image pixel count exceeds the allowed maximum")
                image.verify()
    except ValueError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ValueError("Input image exceeds safe decoding limits") from error
    except (UnidentifiedImageError, OSError, SyntaxError) as error:
        raise ValueError("Input image cannot be decoded") from error
