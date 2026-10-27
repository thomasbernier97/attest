-- Approved procedures. body is the Procedure; draft is the ProcedureDraft it was minted from.
CREATE TABLE procedures (
  id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  draft TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

-- body is the Session; the Session DO rewrites it when the session's state changes.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  procedure_id TEXT NOT NULL REFERENCES procedures (id),
  state TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE segments (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  n INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  file_id TEXT NOT NULL,
  started_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  frame_w INTEGER NOT NULL,
  frame_h INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  PRIMARY KEY (session_id, n)
);

-- One row per processed segment's Tracks, without frames; the full object is in R2.
CREATE TABLE tracks (
  session_id TEXT NOT NULL REFERENCES sessions (id),
  segment_n INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  body TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  PRIMARY KEY (session_id, segment_n)
);

-- Step, hazard and gap events in persistence order (seq).
CREATE TABLE events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  segment_n INTEGER NOT NULL,
  type TEXT NOT NULL,
  step_id TEXT,
  rule_id TEXT,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX events_session ON events (session_id, seq);

CREATE TABLE model_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  request_id TEXT,
  segment_n INTEGER,
  concept_label TEXT,
  started_at INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  cost_micro_usd INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);
CREATE INDEX model_calls_session ON model_calls (session_id);
CREATE INDEX model_calls_started ON model_calls (started_at);
