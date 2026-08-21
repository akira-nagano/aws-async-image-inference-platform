from __future__ import annotations

import urllib.request
import uuid
from collections.abc import Mapping


def upload_presigned_post(
    *,
    url: str,
    fields: Mapping[str, str],
    file_name: str,
    content_type: str,
    content: bytes,
) -> int:
    boundary = f"----imgflow-{uuid.uuid4().hex}"
    body = bytearray()

    def append(value: str | bytes) -> None:
        body.extend(value.encode() if isinstance(value, str) else value)

    for name, value in fields.items():
        append(f"--{boundary}\r\n")
        append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n')
        append(value)
        append("\r\n")

    append(f"--{boundary}\r\n")
    append(f'Content-Disposition: form-data; name="file"; filename="{file_name}"\r\n')
    append(f"Content-Type: {content_type}\r\n\r\n")
    append(content)
    append("\r\n")
    append(f"--{boundary}--\r\n")

    request = urllib.request.Request(
        url,
        method="POST",
        data=bytes(body),
        headers={"content-type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(request) as response:
        return response.status
