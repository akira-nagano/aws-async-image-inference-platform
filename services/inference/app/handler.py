from __future__ import annotations

import json
import os
import time
from typing import Any

import boto3
from botocore.config import Config

from .image_validation import validate_image
from .model_factory import create_model
from .types import InferenceEvent

_endpoint = os.environ.get("AWS_ENDPOINT_URL")
if _endpoint:
    _s3 = boto3.client(
        "s3",
        endpoint_url=_endpoint,
        config=Config(s3={"addressing_style": "path"}),
    )
else:
    _s3 = boto3.client("s3")
_model = create_model()
_input_bucket = os.environ["INPUT_BUCKET_NAME"]
_stub_delay_ms = int(os.environ.get("STUB_INFERENCE_DELAY_MS", "0"))


def handler(event: InferenceEvent, _context: Any) -> dict[str, object]:
    started = time.perf_counter()
    job_id = event["jobId"]
    object_key = event["objectKey"]

    expected_prefix = f"uploads/{event['userId']}/"
    if not object_key.startswith(expected_prefix) or ".." in object_key:
        raise ValueError("Input object key does not belong to the authenticated user")

    response = _s3.get_object(Bucket=_input_bucket, Key=object_key)
    image_bytes = response["Body"].read()
    validate_image(image_bytes)

    if _stub_delay_ms > 0 and os.environ.get("MODEL_PROFILE", "stub") == "stub":
        time.sleep(_stub_delay_ms / 1000)

    predictions = _model.predict(image_bytes)
    processing_time_ms = round((time.perf_counter() - started) * 1000)
    result = {
        "jobId": job_id,
        "modelVersion": _model.version,
        "processingTimeMs": processing_time_ms,
        "predictions": [prediction.to_api() for prediction in predictions],
    }
    print(
        json.dumps(
            {
                "event": "inference_completed",
                "jobId": job_id,
                "modelVersion": _model.version,
                "processingTimeMs": processing_time_ms,
            },
            ensure_ascii=False,
        )
    )
    return result
