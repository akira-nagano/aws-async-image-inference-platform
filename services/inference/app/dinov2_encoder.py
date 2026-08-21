from __future__ import annotations

import importlib
from io import BytesIO
from pathlib import Path
from typing import Any, cast


class Dinov2Encoder:
    def __init__(self, model_directory: str | Path) -> None:
        model_path = Path(model_directory)
        required_files = (
            model_path / "config.json",
            model_path / "preprocessor_config.json",
            model_path / "model.safetensors",
        )
        missing = [str(path) for path in required_files if not path.is_file()]
        if missing:
            raise FileNotFoundError(f"DINOv2 model files are missing: {', '.join(missing)}")

        try:
            torch = importlib.import_module("torch")
            image = importlib.import_module("PIL.Image")
            transformers = importlib.import_module("transformers")
        except ImportError as error:
            raise RuntimeError(
                "The catalog profile requires torch, Pillow, and transformers. "
                "Install services/inference/requirements-catalog.txt."
            ) from error

        self._torch = cast(Any, torch)
        self._image = cast(Any, image)
        transformers_module = cast(Any, transformers)
        self._processor: Any = transformers_module.AutoImageProcessor.from_pretrained(
            model_path,
            local_files_only=True,
        )
        self._model: Any = transformers_module.AutoModel.from_pretrained(
            model_path,
            local_files_only=True,
            use_safetensors=True,
        )
        self._model.eval()

    def encode(self, image_bytes: bytes) -> list[float]:
        with self._image.open(BytesIO(image_bytes)) as image:
            rgb_image = image.convert("RGB")
            inputs = self._processor(images=rgb_image, return_tensors="pt")

        with self._torch.inference_mode():
            output = self._model(**inputs)
            normalized = self._torch.nn.functional.normalize(
                output.pooler_output,
                p=2,
                dim=1,
            )
        return [float(value) for value in normalized[0].tolist()]
