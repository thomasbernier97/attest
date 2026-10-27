// The Attest Worker: session API routes on Hono, and the Session Durable Object.
import { ErrorResponse, ModelId, SegmentN, Sha256Hex, type ErrorCode } from "@attest/shared";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { SAM_MODEL } from "./perception/sam";
import { SPARK_MODEL } from "./perception/spark";
import { CreateSessionRequest, mintProcedure, newSession, sha256Hex } from "./session/create";
import { ConflictError, insertProcedure, insertSession } from "./session/db";
import { errorBody, ERROR_STATUS } from "./session/errors";
import { signToken, verifyToken } from "./session/token";

export { SessionDO } from "./session/session-do";

// Standard-mode model ids only: the Worker fails at startup on any other.
for (const model of [SAM_MODEL, SPARK_MODEL]) ModelId.parse(model);

// Tokens outlive the session's time cap by this much, to cover the wait before the first segment.
const TOKEN_GRACE_MS = 5 * 60_000;
// A 4-second segment is a few MB at most.
const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;

const app = new Hono<{ Bindings: Env }>();

function fail(c: Context, code: ErrorCode, message: string, retryable = false) {
  return c.json(ErrorResponse.parse({ error: errorBody(code, message, retryable) }), ERROR_STATUS[code] as 400);
}

app.onError((error, c) => {
  console.error("unhandled error", error);
  return fail(c, "internal", "internal error", true);
});

app.notFound((c) => fail(c, "not_found", "no such route"));

function sessionStub(env: Env, sessionId: string) {
  return env.SESSIONS.get(env.SESSIONS.idFromName(sessionId));
}

async function authorized(env: Env, token: string | undefined, sessionId: string): Promise<boolean> {
  return token !== undefined && (await verifyToken(env.SESSION_SIGNING_KEY, token, sessionId, Date.now()));
}

app.post("/api/sessions", async (c) => {
  const parsed = CreateSessionRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "invalid_request", z.prettifyError(parsed.error));
  const request = parsed.data;
  const now = Date.now();
  let procedure;
  try {
    procedure = await insertProcedure(c.env.DB, mintProcedure(request.draft, await sha256Hex(request.source_text), now), request.draft);
  } catch (error) {
    if (error instanceof ConflictError) return fail(c, "conflict", "this source text is already stored with a different draft");
    throw error;
  }
  const session = newSession(procedure, request, now);
  await insertSession(c.env.DB, session, now);
  await sessionStub(c.env, session.id).init(session, procedure);
  const expiresAt = now + session.time_cap_ms + TOKEN_GRACE_MS;
  const token = await signToken(c.env.SESSION_SIGNING_KEY, session.id, expiresAt);
  return c.json({ v: 1, session, procedure, token, token_expires_at: expiresAt }, 201);
});

// Browsers cannot set headers on a WebSocket, so the token rides in the query string.
app.get("/api/sessions/:id/ws", async (c) => {
  const sessionId = c.req.param("id");
  if (!(await authorized(c.env, c.req.query("token"), sessionId))) return fail(c, "unauthorized", "missing, bad or expired token");
  if (c.req.header("Upgrade") !== "websocket") return fail(c, "invalid_request", "expected a WebSocket upgrade");
  return sessionStub(c.env, sessionId).fetch(c.req.raw);
});

const SegmentHeaders = z.object({
  started_ms: z.coerce.number().pipe(z.int().nonnegative()),
  duration_ms: z.coerce.number().pipe(z.int().min(1).max(10_000)),
  sha256: Sha256Hex,
});

app.put("/api/sessions/:id/segments/:n", async (c) => {
  const sessionId = c.req.param("id");
  const bearer = c.req.header("Authorization")?.replace(/^Bearer /, "");
  if (!(await authorized(c.env, bearer, sessionId))) return fail(c, "unauthorized", "missing, bad or expired token");
  const n = SegmentN.safeParse(/^\d+$/.test(c.req.param("n")) ? Number(c.req.param("n")) : -1);
  if (!n.success) return fail(c, "invalid_request", "n must be a non-negative integer");
  if (c.req.header("Content-Type") !== "video/mp4") return fail(c, "invalid_request", "the body must be video/mp4");
  const headers = SegmentHeaders.safeParse({
    started_ms: c.req.header("X-Segment-Started-Ms"),
    duration_ms: c.req.header("X-Segment-Duration-Ms"),
    sha256: c.req.header("X-Segment-Sha256")?.toLowerCase(),
  });
  if (!headers.success) return fail(c, "invalid_request", z.prettifyError(headers.error));
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SEGMENT_BYTES) return fail(c, "invalid_request", "the body is empty or too large");
  if ((await sha256Hex(bytes)) !== headers.data.sha256) return fail(c, "invalid_request", "X-Segment-Sha256 does not match the body");
  const result = await sessionStub(c.env, sessionId).putSegment({ n: n.data, ...headers.data, bytes });
  if ("error" in result) return c.json({ error: result.error }, result.status as 400);
  return c.json(result.body, result.status);
});

export default app;
