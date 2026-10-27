import type { ErrorBody, ErrorCode } from "@attest/shared";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  spend_cap: 402,
  model_timeout: 504,
  model_error: 502,
  upload_failed: 500,
  internal: 500,
};

export function errorBody(code: ErrorCode, message: string, retryable = false, requestId: string | null = null): ErrorBody {
  return { code, message, retryable, request_id: requestId };
}
