// The Worker's HTTP API. Every error body is { error: { code, message, retryable, request_id } }.
import type { ErrorBody, Procedure, Session } from "@attest/shared";

export class ApiError extends Error {
  readonly body: ErrorBody;

  constructor(body: ErrorBody) {
    super(`${body.code}: ${body.message}`);
    this.name = "ApiError";
    this.body = body;
  }
}

export async function errorFrom(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { error?: ErrorBody } | null;
  return new ApiError(
    body?.error ?? { code: "internal", message: `HTTP ${String(response.status)}`, retryable: response.status >= 500, request_id: null },
  );
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

export async function compileProcedure(sourceText: string): Promise<Procedure> {
  return (await post<{ procedure: Procedure }>("/api/procedures", { v: 1, source_text: sourceText })).procedure;
}

export async function approveProcedure(id: string): Promise<Procedure> {
  return (await post<{ procedure: Procedure }>(`/api/procedures/${id}/approve`, {})).procedure;
}

export interface CreatedSession {
  session: Session;
  procedure: Procedure;
  token: string;
  token_expires_at: number;
}

export async function createSession(procedureId: string): Promise<CreatedSession> {
  return post<CreatedSession>("/api/sessions", { v: 1, kind: "live", procedure_id: procedureId, user_agent: navigator.userAgent });
}
