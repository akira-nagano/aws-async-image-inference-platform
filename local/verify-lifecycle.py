#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import tempfile
import time
from datetime import UTC, datetime
from typing import Any
import urllib.error
import urllib.request
import uuid

from presigned_post import upload_presigned_post


root = pathlib.Path(__file__).resolve().parents[1]
region = os.environ.get("AWS_DEFAULT_REGION", "ap-northeast-1")
endpoint = os.environ.get("AWS_ENDPOINT_URL", "http://localhost:4566")


def aws(*args: str) -> dict[str, Any]:
    if os.name == "nt":
        command = [
            os.environ.get("COMSPEC", "cmd.exe"),
            "/d",
            "/c",
            str(root / "scripts/aws.cmd"),
        ]
    else:
        command = ["aws"]
    command.extend(["--region", region, "--no-sign-request", *args, "--endpoint-url", endpoint])
    output = subprocess.check_output(command, cwd=root, text=True)
    return json.loads(output) if output.strip() else {}


def stack_outputs() -> dict[str, str]:
    response = aws(
        "cloudformation",
        "describe-stacks",
        "--stack-name",
        "ImgFlow-local",
        "--output",
        "json",
    )
    return {
        item["OutputKey"]: item["OutputValue"]
        for item in response["Stacks"][0].get("Outputs", [])
    }


def function_name(fragment: str) -> str:
    response = aws("lambda", "list-functions", "--output", "json")
    matches = [
        item["FunctionName"]
        for item in response["Functions"]
        if fragment in item["FunctionName"]
    ]
    if len(matches) != 1:
        raise AssertionError(f"Expected one {fragment} function, found {matches}")
    return matches[0]


def put_item(table_name: str, item: dict[str, Any]) -> None:
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        dir=root / "local/.outputs",
        encoding="utf-8",
        delete=False,
    ) as file:
        json.dump(item, file)
        item_path = pathlib.Path(file.name)
    try:
        aws(
            "dynamodb",
            "put-item",
            "--table-name",
            table_name,
            "--item",
            f"file://{item_path}",
            "--output",
            "json",
        )
    finally:
        item_path.unlink(missing_ok=True)


def invoke(function: str, payload: dict[str, Any]) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(dir=root / "local/.outputs") as directory:
        temp = pathlib.Path(directory)
        payload_path = temp / "payload.json"
        response_path = temp / "response.json"
        payload_path.write_text(json.dumps(payload), encoding="utf-8")
        metadata = aws(
            "lambda",
            "invoke",
            "--function-name",
            function,
            "--payload",
            f"fileb://{payload_path}",
            str(response_path),
            "--output",
            "json",
        )
        if metadata.get("FunctionError"):
            raise AssertionError(response_path.read_text(encoding="utf-8"))
        return json.loads(response_path.read_text(encoding="utf-8"))


def get_item(table_name: str, key: dict[str, Any]) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        dir=root / "local/.outputs",
        encoding="utf-8",
        delete=False,
    ) as file:
        json.dump(key, file)
        key_path = pathlib.Path(file.name)
    try:
        response = aws(
            "dynamodb",
            "get-item",
            "--table-name",
            table_name,
            "--key",
            f"file://{key_path}",
            "--consistent-read",
            "--output",
            "json",
        )
        return response.get("Item", {})
    finally:
        key_path.unlink(missing_ok=True)


def seed_held_job(
    *,
    jobs_table: str,
    concurrency_table: str,
    job_id: str,
    user_id: str,
    lease_expires_at: int,
) -> None:
    now = "2026-07-24T00:00:00.000Z"
    put_item(
        jobs_table,
        {
            "jobId": {"S": job_id},
            "userId": {"S": user_id},
            "tier": {"S": "tier-basic"},
            "status": {"S": "RUNNING"},
            "slotState": {"S": "HELD"},
            "activeKey": {"S": "ACTIVE"},
            "leaseExpiresAt": {"N": str(lease_expires_at)},
            "createdAt": {"S": now},
        },
    )
    for scope_key in (f"USER#{user_id}", "SYSTEM#INFERENCE"):
        put_item(
            concurrency_table,
            {
                "scopeKey": {"S": scope_key},
                "activeCount": {"N": "1"},
                "updatedAt": {"S": now},
            },
        )


def request_json(
    method: str,
    url: str,
    *,
    token: str,
    user_id: str,
    groups: str,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    data = None if body is None else json.dumps(body).encode()
    request_headers = {
        "authorization": f"Bearer {token}",
        "x-local-user-id": user_id,
        "x-local-groups": groups,
        **(headers or {}),
    }
    if body is not None:
        request_headers["content-type"] = "application/json"
    request = urllib.request.Request(
        url,
        method=method,
        data=data,
        headers=request_headers,
    )
    try:
        with urllib.request.urlopen(request) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


outputs = stack_outputs()
jobs_table = outputs["JobsTableName"]
concurrency_table = outputs["ConcurrencyTableName"]
finalize_function = function_name("FinalizeJobFunction")
reaper_function = function_name("ReaperFunction")

double_job_id = "integration-double-finalize"
double_user_id = "integration-double-user"
seed_held_job(
    jobs_table=jobs_table,
    concurrency_table=concurrency_table,
    job_id=double_job_id,
    user_id=double_user_id,
    lease_expires_at=int(time.time()) + 300,
)
payload = {
    "jobId": double_job_id,
    "status": "FAILED",
    "error": {"code": "INTEGRATION_TEST", "message": "intentional"},
}
first = invoke(finalize_function, payload)
second = invoke(finalize_function, payload)
assert first == {"released": True}, first
assert second == {"released": False}, second
user_counter = get_item(
    concurrency_table,
    {"scopeKey": {"S": f"USER#{double_user_id}"}},
)
system_counter = get_item(
    concurrency_table,
    {"scopeKey": {"S": "SYSTEM#INFERENCE"}},
)
assert user_counter["activeCount"]["N"] == "0", user_counter
assert system_counter["activeCount"]["N"] == "0", system_counter
print("Double finalize: released once, counters remained at zero")

reaper_job_id = "integration-reaper"
reaper_user_id = "integration-reaper-user"
seed_held_job(
    jobs_table=jobs_table,
    concurrency_table=concurrency_table,
    job_id=reaper_job_id,
    user_id=reaper_user_id,
    lease_expires_at=int(time.time()) - 60,
)
reaper = invoke(reaper_function, {})
assert reaper == {"scanned": 1, "released": 1, "failed": 0, "hasMore": False}, reaper
reaped_job = get_item(jobs_table, {"jobId": {"S": reaper_job_id}})
assert reaped_job["status"]["S"] == "TIMED_OUT", reaped_job
assert reaped_job["slotState"]["S"] == "RELEASED", reaped_job
user_counter = get_item(
    concurrency_table,
    {"scopeKey": {"S": f"USER#{reaper_user_id}"}},
)
system_counter = get_item(
    concurrency_table,
    {"scopeKey": {"S": "SYSTEM#INFERENCE"}},
)
assert user_counter["activeCount"]["N"] == "0", user_counter
assert system_counter["activeCount"]["N"] == "0", system_counter
print("Reaper: stale job timed out and counters released")

token = subprocess.check_output(
    ["bash", "./local/get-token.sh"],
    cwd=root,
    env=os.environ,
    text=True,
).strip()
api_id = outputs["HttpApiEndpoint"].split("://", maxsplit=1)[-1].split(".", maxsplit=1)[0]
api_base = f"{endpoint}/execute-api/{api_id}/$default/api"
system_user_id = "integration-system-limit"
image = b"system-limit-image"
status, upload = request_json(
    "POST",
    f"{api_base}/upload-url",
    token=token,
    user_id=system_user_id,
    groups="tier-basic",
    body={
        "fileName": "system-limit.jpg",
        "contentType": "image/jpeg",
        "sizeBytes": len(image),
    },
)
assert status == 200, (status, upload)
upload_status = upload_presigned_post(
    url=upload["uploadUrl"],
    fields=upload["uploadFields"],
    file_name="system-limit.jpg",
    content_type="image/jpeg",
    content=image,
)
assert upload_status in (200, 201, 204), upload_status

put_item(
    concurrency_table,
    {
        "scopeKey": {"S": "SYSTEM#INFERENCE"},
        "activeCount": {"N": "30"},
        "updatedAt": {"S": "2026-07-24T00:00:00.000Z"},
    },
)
try:
    status, rejection = request_json(
        "POST",
        f"{api_base}/jobs",
        token=token,
        user_id=system_user_id,
        groups="tier-basic",
        body={"objectKey": upload["objectKey"]},
        headers={"idempotency-key": str(uuid.uuid4())},
    )
    assert status == 503, (status, rejection)
    assert rejection["code"] == "INFERENCE_CAPACITY_EXHAUSTED", rejection
finally:
    put_item(
        concurrency_table,
        {
            "scopeKey": {"S": "SYSTEM#INFERENCE"},
            "activeCount": {"N": "0"},
            "updatedAt": {"S": "2026-07-24T00:00:00.000Z"},
        },
    )
user_counter = get_item(
    concurrency_table,
    {"scopeKey": {"S": f"USER#{system_user_id}"}},
)
assert not user_counter or user_counter["activeCount"]["N"] == "0", user_counter
print("System limit: returned 503 without consuming a user slot")

usage_date = datetime.now(UTC).date().isoformat()
upload_daily_user_id = "integration-upload-daily-user"
user_upload_usage_key = f"USAGE#UPLOAD#USER#{upload_daily_user_id}#{usage_date}"
system_upload_usage_key = f"USAGE#UPLOAD#SYSTEM#{usage_date}"
put_item(
    concurrency_table,
    {
        "scopeKey": {"S": user_upload_usage_key},
        "usageCount": {"N": "20"},
        "reservedBytes": {"N": "0"},
    },
)
status, rejection = request_json(
    "POST",
    f"{api_base}/upload-url",
    token=token,
    user_id=upload_daily_user_id,
    groups="tier-basic",
    body={
        "fileName": "daily-count.png",
        "contentType": "image/png",
        "sizeBytes": 1,
    },
)
assert status == 429, (status, rejection)
assert rejection["code"] == "DAILY_UPLOAD_URL_LIMIT_EXCEEDED", rejection

put_item(
    concurrency_table,
    {
        "scopeKey": {"S": user_upload_usage_key},
        "usageCount": {"N": "0"},
        "reservedBytes": {"N": str(10 * 5 * 1024 * 1024)},
    },
)
status, rejection = request_json(
    "POST",
    f"{api_base}/upload-url",
    token=token,
    user_id=upload_daily_user_id,
    groups="tier-basic",
    body={
        "fileName": "daily-bytes.png",
        "contentType": "image/png",
        "sizeBytes": 1,
    },
)
assert status == 429, (status, rejection)
assert rejection["code"] == "DAILY_UPLOAD_BYTES_LIMIT_EXCEEDED", rejection

system_upload_user_id = "integration-upload-system-daily-user"
put_item(
    concurrency_table,
    {
        "scopeKey": {"S": system_upload_usage_key},
        "usageCount": {"N": "200"},
        "reservedBytes": {"N": "0"},
    },
)
status, rejection = request_json(
    "POST",
    f"{api_base}/upload-url",
    token=token,
    user_id=system_upload_user_id,
    groups="tier-basic",
    body={
        "fileName": "system-daily.png",
        "contentType": "image/png",
        "sizeBytes": 1,
    },
)
assert status == 503, (status, rejection)
assert rejection["code"] == "DAILY_UPLOAD_CAPACITY_EXHAUSTED", rejection
print("Daily upload limits: returned user 429 and system 503")

daily_job_user_id = "integration-job-daily-user"
put_item(
    concurrency_table,
    {
        "scopeKey": {"S": system_upload_usage_key},
        "usageCount": {"N": "0"},
        "reservedBytes": {"N": "0"},
    },
)
status, upload = request_json(
    "POST",
    f"{api_base}/upload-url",
    token=token,
    user_id=daily_job_user_id,
    groups="tier-basic",
    body={
        "fileName": "daily-job.png",
        "contentType": "image/png",
        "sizeBytes": len(image),
    },
)
assert status == 200, (status, upload)
upload_status = upload_presigned_post(
    url=upload["uploadUrl"],
    fields=upload["uploadFields"],
    file_name="daily-job.png",
    content_type="image/png",
    content=image,
)
assert upload_status in (200, 201, 204), upload_status

user_job_usage_key = f"USAGE#JOB#USER#{daily_job_user_id}#{usage_date}"
system_job_usage_key = f"USAGE#JOB#SYSTEM#{usage_date}"
put_item(
    concurrency_table,
    {
        "scopeKey": {"S": user_job_usage_key},
        "usageCount": {"N": "10"},
    },
)
status, rejection = request_json(
    "POST",
    f"{api_base}/jobs",
    token=token,
    user_id=daily_job_user_id,
    groups="tier-basic",
    body={"objectKey": upload["objectKey"]},
    headers={"idempotency-key": str(uuid.uuid4())},
)
assert status == 429, (status, rejection)
assert rejection["code"] == "DAILY_JOB_LIMIT_EXCEEDED", rejection

put_item(
    concurrency_table,
    {
        "scopeKey": {"S": user_job_usage_key},
        "usageCount": {"N": "0"},
    },
)
put_item(
    concurrency_table,
    {
        "scopeKey": {"S": system_job_usage_key},
        "usageCount": {"N": "100"},
    },
)
status, rejection = request_json(
    "POST",
    f"{api_base}/jobs",
    token=token,
    user_id=daily_job_user_id,
    groups="tier-basic",
    body={"objectKey": upload["objectKey"]},
    headers={"idempotency-key": str(uuid.uuid4())},
)
assert status == 503, (status, rejection)
assert rejection["code"] == "DAILY_INFERENCE_CAPACITY_EXHAUSTED", rejection
print("Daily job limits: returned user 429 and system 503")
