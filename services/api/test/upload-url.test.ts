import { describe, expect, it } from "bun:test";
import { buildPresignedPostOptions } from "../src/shared/upload-policy.js";

describe("presigned upload policy", () => {
  it("binds content type, owner, expiry, and actual multipart size", () => {
    const options = buildPresignedPostOptions({
      bucket: "input",
      objectKey: "uploads/user-1/image.png",
      contentType: "image/png",
      owner: "user-1",
      expires: 900,
      maxUploadBytes: 1024,
    });

    expect(options).toEqual({
      Bucket: "input",
      Key: "uploads/user-1/image.png",
      Expires: 900,
      Fields: {
        "Content-Type": "image/png",
        "x-amz-meta-owner": "user-1",
      },
      Conditions: [
        ["content-length-range", 1, 1024],
        { "Content-Type": "image/png" },
        { "x-amz-meta-owner": "user-1" },
      ],
    });
  });
});
