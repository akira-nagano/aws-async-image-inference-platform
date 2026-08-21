import type { PresignedPostOptions } from "@aws-sdk/s3-presigned-post";

export function buildPresignedPostOptions(input: {
  bucket: string;
  objectKey: string;
  contentType: string;
  owner: string;
  expires: number;
  maxUploadBytes: number;
}): PresignedPostOptions {
  return {
    Bucket: input.bucket,
    Key: input.objectKey,
    Expires: input.expires,
    Fields: {
      "Content-Type": input.contentType,
      "x-amz-meta-owner": input.owner,
    },
    Conditions: [
      ["content-length-range", 1, input.maxUploadBytes],
      { "Content-Type": input.contentType },
      { "x-amz-meta-owner": input.owner },
    ],
  };
}
