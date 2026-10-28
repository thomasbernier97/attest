// D1 reads and writes. Every write is INSERT OR IGNORE on the row's idempotency key and reads the
// stored row back: a duplicate with the same body is a no-op, one with a different body a conflict,
// and the first write wins.
import {
  Procedure,
  ProcedureDraft,
  TimelineEvent,
  type ModelCall,
  type Session,
  type Tracks,
} from "@attest/shared";

export class ConflictError extends Error {
  constructor(key: string) {
    super(`a different record already has the key ${key}`);
    this.name = "ConflictError";
  }
}

// Stores the procedure, or returns the one already stored from the same source and draft.
export async function insertProcedure(db: D1Database, procedure: Procedure, draft: ProcedureDraft): Promise<Procedure> {
  const key = `procedure:${procedure.source_hash}`;
  const draftJson = JSON.stringify(draft);
  await db
    .prepare("INSERT OR IGNORE INTO procedures (id, source_hash, draft, body, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(procedure.id, procedure.source_hash, draftJson, JSON.stringify(procedure), procedure.compiled_at, key)
    .run();
  const row = await db.prepare("SELECT draft, body FROM procedures WHERE idempotency_key = ?").bind(key).first<{ draft: string; body: string }>();
  if (row === null) throw new Error(`procedure ${key} was not stored`);
  if (JSON.stringify(ProcedureDraft.parse(JSON.parse(row.draft))) !== draftJson) throw new ConflictError(key);
  return Procedure.parse(JSON.parse(row.body));
}

export async function procedureBySourceHash(db: D1Database, sourceHash: string): Promise<Procedure | null> {
  const row = await db.prepare("SELECT body FROM procedures WHERE idempotency_key = ?").bind(`procedure:${sourceHash}`).first<{ body: string }>();
  return row === null ? null : Procedure.parse(JSON.parse(row.body));
}

export async function getProcedure(db: D1Database, id: string): Promise<Procedure | null> {
  const row = await db.prepare("SELECT body FROM procedures WHERE id = ?").bind(id).first<{ body: string }>();
  return row === null ? null : Procedure.parse(JSON.parse(row.body));
}

// Sets approved_at once; an approved procedure is never changed again. Null when there is no such procedure.
export async function approveProcedure(db: D1Database, id: string, now: number): Promise<Procedure | null> {
  await db
    .prepare("UPDATE procedures SET body = json_set(body, '$.approved_at', ?) WHERE id = ? AND json_extract(body, '$.approved_at') IS NULL")
    .bind(now, id)
    .run();
  return getProcedure(db, id);
}

export async function insertSession(db: D1Database, session: Session, createdAt: number): Promise<void> {
  await db
    .prepare("INSERT INTO sessions (id, procedure_id, state, body, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(session.id, session.procedure_id, session.state, JSON.stringify(session), createdAt)
    .run();
}

export async function updateSession(db: D1Database, session: Session): Promise<void> {
  await db.prepare("UPDATE sessions SET state = ?, body = ? WHERE id = ?").bind(session.state, JSON.stringify(session), session.id).run();
}

export interface SegmentRow {
  session_id: string;
  n: number;
  sha256: string;
  r2_key: string;
  file_id: string;
  started_ms: number;
  duration_ms: number;
  // When capture of the segment ended, on the browser's clock (X-Segment-Ended-At).
  capture_ended_at: number;
  frame_w: number;
  frame_h: number;
  received_at: number;
  state: "queued" | "processing" | "done" | "gap";
}

export async function insertSegment(db: D1Database, row: SegmentRow): Promise<void> {
  const key = `segment:${row.session_id}:${String(row.n)}`;
  await db
    .prepare(
      "INSERT OR IGNORE INTO segments (session_id, n, sha256, r2_key, file_id, started_ms, duration_ms, capture_ended_at, frame_w, frame_h, received_at, state, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(row.session_id, row.n, row.sha256, row.r2_key, row.file_id, row.started_ms, row.duration_ms, row.capture_ended_at, row.frame_w, row.frame_h, row.received_at, row.state, key)
    .run();
  const stored = await db.prepare("SELECT sha256 FROM segments WHERE idempotency_key = ?").bind(key).first<{ sha256: string }>();
  if (stored?.sha256 !== row.sha256) throw new ConflictError(key);
}

export async function updateSegmentState(db: D1Database, sessionId: string, n: number, state: SegmentRow["state"]): Promise<void> {
  await db.prepare("UPDATE segments SET state = ? WHERE session_id = ? AND n = ?").bind(state, sessionId, n).run();
}

// The D1 row has no frames; the full Tracks object is in R2 at r2Key.
export async function insertTracks(db: D1Database, tracks: Tracks, r2Key: string): Promise<void> {
  const key = `tracks:${tracks.session_id}:${String(tracks.segment_n)}`;
  const body = {
    ...tracks,
    objects: tracks.objects.map((object) => ({
      label: object.label,
      prompt: object.prompt,
      model_call_id: object.model_call_id,
      confidence: object.confidence,
      present_ratio: object.present_ratio,
    })),
  };
  await db
    .prepare("INSERT OR IGNORE INTO tracks (session_id, segment_n, file_id, r2_key, body, latency_ms, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(tracks.session_id, tracks.segment_n, tracks.file_id, r2Key, JSON.stringify(body), tracks.latency_ms, key)
    .run();
}

// Stores the event and returns it with whether this call inserted it.
export async function insertEvent(db: D1Database, event: TimelineEvent): Promise<{ event: TimelineEvent; inserted: boolean }> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO events (id, session_id, segment_n, type, step_id, rule_id, body, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(
      event.id,
      event.session_id,
      event.segment_n,
      event.type,
      "step_id" in event ? event.step_id : null,
      "rule_id" in event ? event.rule_id : null,
      JSON.stringify(event),
      event.idempotency_key,
    )
    .run();
  if (result.meta.changes > 0) return { event, inserted: true };
  const row = await db.prepare("SELECT body FROM events WHERE idempotency_key = ?").bind(event.idempotency_key).first<{ body: string }>();
  if (row === null) throw new Error(`event ${event.idempotency_key} was not stored`);
  return { event: TimelineEvent.parse(JSON.parse(row.body)), inserted: false };
}

// Events after last_event_id in persistence order; all of them when it is null or unknown.
export async function eventsAfter(db: D1Database, sessionId: string, lastEventId: string | null): Promise<TimelineEvent[]> {
  const { results } = await db
    .prepare(
      "SELECT body FROM events WHERE session_id = ?1 AND seq > COALESCE((SELECT seq FROM events WHERE id = ?2 AND session_id = ?1), 0) ORDER BY seq",
    )
    .bind(sessionId, lastEventId)
    .all<{ body: string }>();
  return results.map((row) => TimelineEvent.parse(JSON.parse(row.body)));
}

export async function insertModelCall(db: D1Database, call: ModelCall): Promise<void> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO model_calls (id, session_id, purpose, model, request_id, segment_n, concept_label, started_at, latency_ms, cost_micro_usd, outcome, body, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      call.id,
      call.session_id,
      call.purpose,
      call.model,
      call.request_id,
      call.segment_n,
      call.concept_label,
      call.started_at,
      call.latency_ms,
      call.cost_micro_usd,
      call.outcome,
      JSON.stringify(call),
      call.idempotency_key,
    )
    .run();
}

// Spend so far for the session and for the UTC day that contains now.
export async function spendSoFar(db: D1Database, sessionId: string, now: number): Promise<{ session: number; daily: number }> {
  const dayStart = now - (now % 86_400_000);
  const row = await db
    .prepare(
      "SELECT (SELECT COALESCE(SUM(cost_micro_usd), 0) FROM model_calls WHERE session_id = ?) AS session, (SELECT COALESCE(SUM(cost_micro_usd), 0) FROM model_calls WHERE started_at >= ?) AS daily",
    )
    .bind(sessionId, dayStart)
    .first<{ session: number; daily: number }>();
  return { session: row?.session ?? 0, daily: row?.daily ?? 0 };
}
