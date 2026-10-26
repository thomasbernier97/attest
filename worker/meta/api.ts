// Calls to Meta's Model API. Fetch and Web APIs only, so the same code runs in the Worker and in
// scripts. The key is only ever placed in the Authorization header; no error message carries it.

export const META_API_BASE = "https://api.meta.ai/v1";

export class MetaApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(path: string, status: number, body: string) {
    super(`Meta API ${path} returned ${String(status)}: ${body.slice(0, 500)}`);
    this.name = "MetaApiError";
    this.status = status;
    this.body = body;
  }
}

export interface MetaClient {
  apiKey: string;
  // Requests this client may still send; every request is refused once it reaches 0.
  requestsLeft: number;
}

export async function metaFetch(client: MetaClient, path: string, init: RequestInit): Promise<Response> {
  if (client.requestsLeft <= 0) throw new Error(`Meta request budget spent; refused ${path}`);
  client.requestsLeft -= 1;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${client.apiKey}`);
  const response = await fetch(`${META_API_BASE}${path}`, { ...init, headers });
  if (!response.ok) throw new MetaApiError(path, response.status, await response.text());
  return response;
}
