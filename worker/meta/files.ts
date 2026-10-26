import { metaFetch, type MetaClient } from "./api";

// Every upload expires after 7 days; the deletion job also deletes the file_id sooner.
export const FILE_EXPIRES_AFTER_SECONDS = 7 * 24 * 60 * 60;

export interface MetaFile {
  id: string;
  bytes: number;
  created_at: number | null;
  expires_at: number | null;
}

export interface UploadResult {
  file: MetaFile;
  // The response body as received.
  raw: unknown;
  latency_ms: number;
}

export async function uploadFile(client: MetaClient, data: Blob, filename: string): Promise<UploadResult> {
  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("expires_after[anchor]", "created_at");
  form.set("expires_after[seconds]", String(FILE_EXPIRES_AFTER_SECONDS));
  form.set("file", data, filename);
  const started = Date.now();
  const response = await metaFetch(client, "/files", { method: "POST", body: form });
  const raw: unknown = await response.json();
  const latency_ms = Date.now() - started;
  const body = raw as Partial<MetaFile>;
  if (typeof body.id !== "string") throw new Error("Files API response has no id");
  return {
    file: {
      id: body.id,
      bytes: body.bytes ?? data.size,
      created_at: body.created_at ?? null,
      expires_at: body.expires_at ?? null,
    },
    raw,
    latency_ms,
  };
}
