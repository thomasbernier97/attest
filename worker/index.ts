// The Attest Worker: procedure and session API routes on Hono, and the Session Durable Object.
// Everything outside /api/ is the web app, served from the static assets.
import { ErrorResponse, ModelId, SegmentN, Sha256Hex, type ErrorCode } from "@attest/shared";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "./env";
import { MetaApiError } from "./meta/api";
import { callCost } from "./meta/cost";
import { DAILY_SPEND_CAP_MICRO_USD } from "./perception/config";
import { SAM_MODEL } from "./perception/sam";
import { SPARK_MODEL, SparkReplyError, type ResponseBody } from "./perception/spark";
import { COMPILE_TIMEOUT_MS, COMPILE_WORST_CASE_TOKENS, compileCallRow, compileProcedure } from "./procedure/compile";
import { CompileProcedureRequest, CreateSessionRequest, mintProcedure, newSession, sha256Hex } from "./session/create";
import {
  ConflictError,
  approveProcedure,
  getProcedure,
  insertModelCall,
  insertProcedure,
  insertSession,
  procedureBySourceHash,
  spendSoFar,
} from "./session/db";
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

// Compiles procedure text into a Procedure awaiting approval. The same text returns the procedure
// already stored from it, without a model call.
app.post("/api/procedures", async (c) => {
  const parsed = CompileProcedureRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "invalid_request", z.prettifyError(parsed.error));
  const text = parsed.data.source_text;
  const sourceHash = await sha256Hex(text);
  const existing = await procedureBySourceHash(c.env.DB, sourceHash);
  if (existing !== null) return c.json({ v: 1, procedure: existing }, 200);

  const worst = callCost({ model: SPARK_MODEL, tokens_cached: 0, media_units: 0, media_unit_kind: "none", ...COMPILE_WORST_CASE_TOKENS });
  if ((await spendSoFar(c.env.DB, "", Date.now())).daily + worst > DAILY_SPEND_CAP_MICRO_USD) {
    return fail(c, "spend_cap", "the daily spend cap would be passed");
  }
  const startedAt = Date.now();
  let call;
  try {
    call = await compileProcedure({ apiKey: c.env.META_API_KEY, requestsLeft: 1 }, { text, timeout_ms: COMPILE_TIMEOUT_MS });
  } catch (error) {
    // Spark answered but the answer was rejected: the call still has an id and usage.
    const raw = error instanceof SparkReplyError ? (error.raw as ResponseBody) : null;
    const row = compileCallRow(
      { model_call_id: crypto.randomUUID(), response_id: raw?.id ?? null, started_at: startedAt, latency_ms: Date.now() - startedAt, usage: raw?.usage ?? null },
      error,
    );
    await insertModelCall(c.env.DB, row);
    console.error("procedure compile failed", row.error_code, error instanceof Error ? error.message.slice(0, 500) : error);
    if (row.outcome === "timeout") return fail(c, "model_timeout", "the procedure reader took too long", true);
    if (row.outcome === "rate_limited") return fail(c, "rate_limited", "the procedure reader is rate limited", true);
    if (error instanceof SparkReplyError) return fail(c, "model_error", "the procedure reader returned a draft that does not validate");
    return fail(c, "model_error", "the procedure reader failed", !(error instanceof MetaApiError && error.status < 500));
  }
  await insertModelCall(c.env.DB, compileCallRow(call));
  try {
    const procedure = await insertProcedure(c.env.DB, mintProcedure(call.draft, sourceHash, call.started_at, call.model_call_id), call.draft);
    return c.json({ v: 1, procedure }, 201);
  } catch (error) {
    // Another request compiled the same text first, to a different draft; the first one stays.
    if (error instanceof ConflictError) return c.json({ v: 1, procedure: await procedureBySourceHash(c.env.DB, sourceHash) }, 200);
    throw error;
  }
});

app.get("/api/procedures/:id", async (c) => {
  const procedure = await getProcedure(c.env.DB, c.req.param("id"));
  if (procedure === null) return fail(c, "not_found", "no such procedure");
  return c.json({ v: 1, procedure });
});

// Approves a procedure. Approving it again returns it unchanged.
app.post("/api/procedures/:id/approve", async (c) => {
  const procedure = await approveProcedure(c.env.DB, c.req.param("id"), Date.now());
  if (procedure === null) return fail(c, "not_found", "no such procedure");
  return c.json({ v: 1, procedure });
});

app.post("/api/sessions", async (c) => {
  const parsed = CreateSessionRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, "invalid_request", z.prettifyError(parsed.error));
  const request = parsed.data;
  const procedure = await getProcedure(c.env.DB, request.procedure_id);
  if (procedure === null) return fail(c, "not_found", "no such procedure");
  if (procedure.approved_at === null) return fail(c, "invalid_request", "the procedure is not approved");
  const now = Date.now();
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
  // Epoch ms on the browser's clock; latency_ms counts from it.
  capture_ended_at: z.coerce.number().pipe(z.int().positive()),
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
    capture_ended_at: c.req.header("X-Segment-Ended-At"),
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
