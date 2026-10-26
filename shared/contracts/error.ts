import { z } from "zod";

export const ERROR_BODY_VERSION = 1;

export const ErrorCode = z.enum([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "rate_limited",
  "spend_cap",
  "model_timeout",
  "model_error",
  "upload_failed",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  code: ErrorCode,
  message: z.string(),
  retryable: z.boolean(),
  request_id: z.string().nullable(),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

// The HTTP error body; the WebSocket error message carries the same `error` field.
export const ErrorResponse = z.object({ error: ErrorBody });
export type ErrorResponse = z.infer<typeof ErrorResponse>;
