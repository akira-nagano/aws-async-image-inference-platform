import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  requestId?: string,
  details?: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  const body: ApiErrorBody = { code, message };
  if (requestId) body.requestId = requestId;
  if (details) body.details = details;
  return jsonResponse(statusCode, body);
}
