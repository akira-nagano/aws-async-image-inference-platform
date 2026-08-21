#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from presigned_post import upload_presigned_post

api = os.environ["TEST_API_BASE_URL"].rstrip("/")
token = os.environ["TEST_ACCESS_TOKEN"]
local_user_id = os.environ.get("TEST_LOCAL_USER_ID")
local_groups = os.environ.get("TEST_LOCAL_GROUPS")


def request_json(method: str, url: str, body: dict | None = None, headers: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    all_headers = {"authorization": f"Bearer {token}", **(headers or {})}
    if local_user_id:
        all_headers["x-local-user-id"] = local_user_id
    if local_groups:
        all_headers["x-local-groups"] = local_groups
    if body is not None:
        all_headers["content-type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=all_headers)
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


image = (Path(__file__).resolve().parents[1] / "examples" / "sample-image.png").read_bytes()
status, upload = request_json(
    "POST",
    f"{api}/api/upload-url",
    {"fileName": "smoke.png", "contentType": "image/png", "sizeBytes": len(image)},
)
assert status == 200, (status, upload)
upload_status = upload_presigned_post(
    url=upload["uploadUrl"],
    fields=upload["uploadFields"],
    file_name="smoke.png",
    content_type="image/png",
    content=image,
)
assert upload_status in (200, 201, 204), upload_status

status, job = request_json(
    "POST",
    f"{api}/api/jobs",
    {"objectKey": upload["objectKey"]},
    {"idempotency-key": str(uuid.uuid4())},
)
assert status == 202, (status, job)
print("Job accepted:", job["jobId"])

for _ in range(90):
    status, current = request_json("GET", f"{api}/api/jobs/{job['jobId']}")
    assert status == 200, (status, current)
    print("status:", current["status"])
    if current["status"] in {"SUCCEEDED", "FAILED", "TIMED_OUT", "SUBMIT_FAILED"}:
        assert current["status"] == "SUCCEEDED", current
        assert len(current["predictions"]) == 3
        print(json.dumps(current, ensure_ascii=False, indent=2))
        break
    time.sleep(1)
else:
    raise RuntimeError("Job did not complete")
