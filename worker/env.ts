import type { SessionDO } from "./session/session-do";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  SESSIONS: DurableObjectNamespace<SessionDO>;
  // Wrangler secrets; worker/.dev.vars locally.
  META_API_KEY: string;
  SESSION_SIGNING_KEY: string;
}
