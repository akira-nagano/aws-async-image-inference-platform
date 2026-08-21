import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { S3Client } from "@aws-sdk/client-s3";
import { SFNClient } from "@aws-sdk/client-sfn";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const endpoint = process.env.AWS_ENDPOINT_URL;
const baseConfig = endpoint ? { endpoint } : {};

export const s3Client = new S3Client({
  ...baseConfig,
  forcePathStyle: Boolean(endpoint),
});

export const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient(baseConfig), {
  marshallOptions: { removeUndefinedValues: true },
});

export const lambdaClient = new LambdaClient(baseConfig);
export const sfnClient = new SFNClient(baseConfig);
