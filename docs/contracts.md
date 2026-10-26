# Contracts v1 — field-level specification (pre-kickoff)

> **Note.** Transcribed Oct 26, 2026 from the Notion page "Contracts v1 — field-level specification (pre-kickoff)" as written Oct 24, 2026 (last edited 2026-10-24 02:28 UTC); the Notion page is no longer edited. Amended Oct 26, 2026 by Thomas, matching the spec's 2026-10-26 change log: `ObjectDraft` objects have no cap, the Model IDs row adds `muse-wonder-1.0` once ATT-122 confirms it, and items 6 and 7 of "Changes to the spec" follow his decisions. All other text is unchanged.

> 📏 Field-level specification of every contract in the spec's section 7, plus the conventions all seats share. Written Oct 24, 2026 as prose so the Day 1 Zod commit (ATT-15) is transcription. At kickoff this page becomes `docs/contracts.md` (ATT-12) and stops being edited here. Where this page tightens or changes the spec table, the change is listed at the end and goes through the spec's change log.

## Conventions every seat follows

These decide the things five seats would otherwise each decide differently. A seat that needs an exception files a Triage request; it does not improvise.

| Convention | Rule |
| --- | --- |
| Identifiers | Every id Attest mints is a lowercase UUID v4 string from `crypto.randomUUID()` (no library, same in Workers and browsers). Meta identifiers (`file_id`, `request_id`, ASR `turnId`) are stored verbatim in fields named for them. Segments are numbered by integer `n` starting at 0 per session; `n` is never a UUID. |
| Time | All times are integers in milliseconds. Suffix `_at` = Unix epoch ms, UTC, from the server clock (`Date.now()` in the Worker). Suffix `_ms` = offset from `session.started_at`. Inside a segment, `t_ms` = offset from the segment's own start. No ISO strings, no seconds, no floats. The browser never sets an `_at` field. |
| Confidence | A number in [0, 1]. Thresholds live in `worker/perception/config.ts`, never in a contract. |
| Money and usage | Cost is an integer in micro-USD (`cost_micro_usd`; $1 = 1,000,000). Tokens are integers. Media usage is an integer `media_units` with `media_unit_kind` saying what the unit is. Prices come from one versioned table, `shared/pricing.ts`, carrying the as-of date it was read from [dev.meta.ai](http://dev.meta.ai) (Oct 23, 2026 values in the API facts page). |
| Enums | Lowercase `snake_case` string literals. Adding a value is a Contract PR. |
| Strings | UTF-8, trimmed. Spoken text (`say.text`, hazard `message`) is capped at 40 words; rationales at 40 words; summaries at 60 words. Caps are enforced by the validator, not trusted from the model. |
| Versioning | Every contract exports `version: 1`. Every WebSocket message and every persisted record carries `v: 1`. A breaking change bumps the number and updates every consumer in the same merge. |
| Nullability | A field that may be absent is `null`, never missing and never `undefined`. Zod: `.nullable()`, not `.optional()`, on everything a consumer reads. |
| Error shape | One shape everywhere (HTTP body and WebSocket `error` message): `{ error: { code, message, retryable, request_id } }`. `code` is from the error enum below; `message` is for humans and never contains secrets; `retryable` is a boolean the client acts on; `request_id` is Meta's id when the error came from a model call, else null. |
| Error codes | `invalid_request` (400), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409, idempotent duplicate with a different body), `rate_limited` (429), `spend_cap` (402), `model_timeout` (504), `model_error` (502), `upload_failed` (500), `internal` (500). Worker and browser both switch on the code, never on the message. |
| Gaps | A period where the system could not observe is a first-class `GapEvent` on the timeline, persisted and exported like any event. No step or hazard state changes on a gapped segment. Nothing is ever inferred across a gap. Steps are not marked unobserved from evidence that spans a gap. |
| Idempotency | Every persisted record has an `idempotency_key` string with a D1 unique index; writes are `INSERT OR IGNORE` and return the existing row. Key recipes are given per contract below. A duplicate with a different body is a `conflict`, logged to Sentry, and the first write wins. |
| JSON Schema for Meta | Schemas sent to Muse Spark as structured output (`ProcedureDraft`, `Observation`) are generated from the Zod schema with `strict: true` semantics: root is an object, every object sets `additionalProperties: false`, every property is in `required`, no `allOf`/`oneOf`, depth ≤ 10, no recursion. CI generates both and fails on a violation (ATT-15 research note). |
| Model IDs | The only model ids any contract accepts: `muse-spark-1.3`, `sam-3.1`, `muse-voice-transcribe-1.0`, `muse-image-1.0`, and `muse-wonder-1.0` once ATT-122 confirms it. Startup fails on anything else (ATT-34). |

## Procedure and ProcedureDraft (C produces; B, D consume)

The compiler asks Spark for a `ProcedureDraft` (no ids, no keys, no approval) using structured output. After operator approval, Seat C mints ids and keys and stores a `Procedure`.

```javascript
ProcedureDraft {
  v: 1
  title: string (1–120)
  language: string (BCP-47, default "en")
  steps: ProcedureStepDraft[] (1–30, ordinal order)
  objects: ObjectDraft[] (at least 1, no cap)
  hazard_rules: HazardRuleDraft[] (0–8)
}
ProcedureStepDraft {
  ordinal: int (1-based, unique, contiguous)
  instruction: string (worker-readable, 1–240)
  expected_objects: object_label[] (0–4, each a label in objects)
  completion_cue: string (what "done" looks like on camera, 1–160)
  cue_kind: "object_placed" | "object_state" | "object_motion" | "tool_use" | "worker_action"
  depends_on: int[] (ordinals; all lower than this ordinal)
}
ObjectDraft {
  label: string (slug: ^[a-z0-9_]{1,32}$, unique)
  display_name: string (1–40)
  prompt: string (SAM noun phrase, 1–6 words, concrete noun, one concept)
}
HazardRuleDraft {
  condition: string (worker-readable, 1–160)
  condition_kind: "object_present" | "object_absent" | "object_state"
  object_label: object_label
  before_step: int (ordinal)
  severity: "block" | "warn"
  message: string (spoken when violated, ≤ 20 words)
}
```

```javascript
Procedure {
  v: 1
  id: uuid
  title, language, as draft
  source: "text" | "pdf" | "photo" | "voice"
  source_hash: string (sha256 hex of the source text or file)
  compiled_at: epoch_ms
  approved_at: epoch_ms | null
  approved_by: string | null (operator Access email; null until approved)
  steps: ProcedureStep[]      // draft fields plus: id: uuid, depends_on: uuid[], reference_image_key: string | null (R2 key)
  objects: ProcedureObject[]  // draft fields plus: id: uuid, color: string (hex, assigned by C for the overlay)
  hazard_rules: HazardRule[]  // draft fields plus: id: uuid, before_step: uuid
  compile_call_id: uuid (ModelCall)
}
```

Validation beyond types: every `expected_objects` and `object_label` names an existing object; every `depends_on` and `before_step` names an existing step with a lower ordinal; a procedure is only usable in a session when `approved_at` is not null. Idempotency key: `procedure:${source_hash}` (recompiling the same text returns the existing draft).

## Session (A owns)

Not in the spec table, but every message and event references it.

```javascript
Session {
  v: 1
  id: uuid
  procedure_id: uuid
  kind: "live" | "replay"
  recording_id: uuid | null (set when kind = replay)
  state: "created" | "running" | "closed"
  closed_reason: "completed" | "worker" | "operator" | "spend_cap" | "time_cap" | "error" | null
  started_at: epoch_ms | null (first segment accepted)
  ended_at: epoch_ms | null
  segment_ms: int (4000 unless the Day 1 gate changes it)
  fps: int (set from ATT-129)
  time_cap_ms: int (600000)
  spend_cap_micro_usd: int
  client: { user_agent: string, encoder: "webcodecs_h264" }
  consent_shown_at: epoch_ms (the live page's recording notice)
}
```

A session accepts segments only while `state = running`; `n` must equal the next expected index or be a duplicate of an accepted one (returned idempotently). Anything else is `invalid_request`.

## ClientMessage (D → A, WebSocket up)

JSON text frames. Envelope `{ v: 1, type, ...payload }`. One message per frame.

```javascript
audio          { pcm16: base64 (16 kHz, mono, signed 16-bit LE, 100 ms = 3200 bytes), ms: int (session-relative capture time of the first sample) }
worker_confirm { step_id: uuid, answer: "yes" | "no", via: "voice" | "tap", utterance_id: uuid | null }
resume         { last_event_id: uuid | null }   // first message after a reconnect; server replies with session_state then every event after last_event_id
ping           { sent_at: epoch_ms }
end            { reason: "worker" | "operator" }
```

Segment timing no longer travels on the socket (see Changes to the spec): the PUT carries it.

## Segment upload (D → A, HTTP)

`PUT /api/sessions/:id/segments/:n` with body `video/mp4` (faststart, H.264, one standalone segment) and headers `X-Segment-Started-Ms` (session-relative), `X-Segment-Duration-Ms`, `X-Segment-Sha256`. Response `202 { v: 1, n, r2_key, file_id, state: "queued" }`. A repeat PUT of an accepted `n` with the same sha256 returns `200` with the same body; a different sha256 is `conflict`. R2 key: `sessions/${session_id}/segments/${n}.mp4`. The Files API upload sets `expires_after` 7 days. Idempotency key: `segment:${session_id}:${n}`.

## ServerMessage (A → D, WebSocket down)

Envelope `{ v: 1, type, server_at: epoch_ms, ...payload }`.

```javascript
session_state { session: Session, procedure_id: uuid, steps: StepState[], hazards: HazardState[], next_segment_n: int, last_event_id: uuid | null }
  StepState   { step_id: uuid, state: "pending" | "active" | "completed" | "unobserved" | "blocked", updated_ms: int, event_id: uuid | null }
  HazardState { rule_id: uuid, state: "armed" | "satisfied" | "violated" | "cleared", updated_ms: int, event_id: uuid | null }
segment_ack   { n: int, state: "queued" | "processing" | "done" | "gap" }
tracks        { n: int, frame_w: int, frame_h: int, objects: [{ label, color, confidence, boxes: [{ t_ms: int, x1, y1, x2, y2: int (px) }] }] }   // boxes only; masks stay server-side unless ATT-131 decides otherwise
step_event    StepEvent
hazard_event  HazardEvent
gap           GapEvent
utterance     Utterance
say           { id: uuid, text: string (≤ 40 words), language: string, ref: { kind: "step" | "hazard" | "answer" | "system", id: uuid | null }, ends_listening_until_ms: int }   // the browser suppresses intents from utterances that overlap playback
spend         { session_micro_usd: int, daily_micro_usd: int, cap_micro_usd: int }
error         { error: ErrorBody }
pong          { sent_at: epoch_ms }
closed        { reason: Session.closed_reason, report_url: string }
```

Ordering: events are broadcast in persistence order; `session_state` is always the first message after connect or `resume`; the client treats its own state as derived from `session_state` plus events, never from `tracks`.

## Tracks (B produces; B, D consume; persisted per segment)

```javascript
Tracks {
  v: 1
  session_id: uuid
  segment_n: int
  file_id: string (Meta)
  fps: int
  frame_w: int, frame_h: int
  objects: [{
    label: object_label
    prompt: string (as sent)
    model_call_id: uuid
    confidence: number (mean over frames with a box)
    present_ratio: number (frames with a box / frames)
    frames: [{ t_ms: int, box: [x1, y1, x2, y2] (int px), mask_key: string | null }]
  }]
  latency_ms: int (first request sent → last response.completed)
}
```

One SAM request per object label (one concept per request, per the docs). `frames` is empty when SAM returns zero matches; that is a valid result, not a gap. Idempotency key: `tracks:${session_id}:${segment_n}`. D1 stores the row without `frames`; the full object goes to R2 at `sessions/${session_id}/tracks/${n}.json`.

## Observation (Spark → B; validated before anything reads it)

The JSON Schema sent to Spark is generated per procedure so `step_id`, `rule_id` and `object_labels` are enums of that procedure's ids and labels.

```javascript
Observation {
  segment_summary: string (≤ 60 words)
  worker_activity: "working" | "idle" | "hands_not_visible" | "away"
  step_observations: [{
    step_id: enum(step ids)
    state: "in_progress" | "completed" | "not_observed" | "cannot_tell"
    confidence: number [0, 1]
    evidence: { object_labels: enum(labels)[], moment_ms: int [0, segment_ms], description: string (≤ 25 words) }
  }]
  hazards: [{
    rule_id: enum(rule ids)
    state: "satisfied" | "violated" | "cannot_tell"
    confidence: number [0, 1]
    evidence: { object_labels: enum(labels)[], moment_ms: int, description: string (≤ 25 words) }
  }]
}
```

Validator rejections (each a Sentry breadcrumb and a counter, never a thrown error): unknown step, rule or label even though the schema should prevent it; confidence outside [0, 1]; `completed` with empty `object_labels`; `moment_ms` outside the segment; `completed` for a step whose `depends_on` are not all completed in the state machine (downgraded to `in_progress`, flagged `dependency_violation`); any observation on a segment that has a gap. The state machine (ATT-30, ATT-45) decides from validated observations plus `Tracks`; the model never sets a state directly.

## Events: StepEvent, HazardEvent, GapEvent (B → A persists, D renders)

All three share a base and one D1 table.

```javascript
EventBase {
  v: 1
  id: uuid
  session_id: uuid
  segment_n: int
  detected_at: epoch_ms
  session_ms: int
  latency_ms: int (detected_at − the wall-clock end of segment_n; the number the measurement table reports)
  source: "observation" | "tracks" | "worker_confirm" | "rule" | "system"
  confidence: number | null
  rationale: string (≤ 40 words)
  clip_key: string | null (R2 key of the segment MP4; null only on gaps with no segment)
  tracks_segment_n: int | null
  utterance_id: uuid | null
  idempotency_key: string
}
StepEvent   = EventBase + { type: "step_completed" | "step_unobserved" | "step_resumed" | "step_confirmed_done" | "step_confirmed_not_done", step_id: uuid }
HazardEvent = EventBase + { type: "hazard_satisfied" | "hazard_violated" | "hazard_cleared", rule_id: uuid, blocked_step_id: uuid | null }
GapEvent    = EventBase + { type: "gap", reason: "model_timeout" | "model_error" | "rate_limited" | "upload_missing" | "network" | "spend_cap", affected: ("sam" | "spark" | "asr" | "upload")[], ended_at: epoch_ms | null }
```

Idempotency keys: `event:${session_id}:${type}:${step_id | rule_id | "-"}:${segment_n}`. The same step may legitimately be unobserved in segment 7 and completed in segment 9; the key keeps both. A gap's key is `event:${session_id}:gap:-:${segment_n}` and a later `ended_at` is an update to that row, not a second event.

## Utterance (C → A, B, D)

```javascript
Utterance {
  v: 1
  id: uuid
  session_id: uuid
  turn_id: int (ASR turnId)
  text: string (final transcript from speechComplete)
  language: string | null (detected; null if the model did not say)
  started_ms: int, ended_ms: int (session-relative, from audioProcessedMs)
  asr_latency_ms: int (speechEnd → speechComplete)
  intent: "start" | "next" | "done" | "repeat" | "go_back" | "yes" | "no" | "question" | "none"
  intent_confidence: number
  overlapped_say_id: uuid | null (non-null when the turn overlapped system speech; intents from such turns are ignored)
  answer_call_id: uuid | null (ModelCall when intent = question)
}
```

Only `speechComplete` turns become Utterances; partials never leave Seat C. Idempotency key: `utterance:${session_id}:${turn_id}`.

## ModelCall (all seats → A's ledger)

```javascript
ModelCall {
  v: 1
  id: uuid
  session_id: uuid | null (null for compile and image calls made outside a session)
  purpose: "compile" | "track" | "observe" | "answer" | "transcribe" | "image" | "narrate"
  model: ModelId
  request_id: string | null (Meta's)
  segment_n: int | null
  concept_label: object_label | null (track only)
  started_at: epoch_ms
  latency_ms: int
  tokens_in: int, tokens_cached: int, tokens_out: int
  media_units: int
  media_unit_kind: "frames" | "images" | "audio_seconds" | "none"
  cost_micro_usd: int (from shared/pricing.ts; recomputed from the row, never trusted from the caller)
  outcome: "ok" | "timeout" | "error" | "rate_limited" | "spend_cap"
  error_code: string | null
  idempotency_key: string
}
```

Idempotency key: `call:${request_id}` when Meta returned one, else `call:${session_id}:${purpose}:${segment_n}:${concept_label | "-"}:${attempt}`. The spend cap (ATT-53) is evaluated on the sum of `cost_micro_usd` for the session and for the UTC day before any call is made, using the price table's worst case for the call about to be sent.

## Recording and Labels (E and Thomas → B)

```javascript
Recording {
  v: 1
  id: uuid
  source_session_id: uuid (the live session that was recorded)
  procedure_id: uuid, procedure_hash: string
  r2_prefix: string (sessions/<source_session_id>/)
  segment_count: int, segment_ms: int, fps: int
  recorded_at: epoch_ms
  scenario: "clean" | "skip" | "hazard" | "skip_and_hazard"
  notes: string
}
Labels {
  v: 1
  recording_id: uuid
  labeled_by: string, labeled_at: epoch_ms
  steps:   [{ step_id: uuid, completed_at_ms: int | null, skipped_at_ms: int | null }]   // completed_at_ms = the moment the labeler judges the step done on video; skipped_at_ms = the moment the next step visibly begins without it
  hazards: [{ rule_id: uuid, violated_at_ms: int, cleared_at_ms: int | null }]
  notes: string
}
```

Labels are written by hand from the recording, never from Attest's own events. Idempotency: one `Labels` per `recording_id`; a relabel replaces it and keeps `labeled_at`.

## MeasurementTable (B → D, E)

```javascript
MeasurementTable {
  v: 1
  computed_at: epoch_ms
  sha: string (git)
  model_ids: { spark: ModelId, sam: ModelId, voice: ModelId }
  thresholds_version: string, thresholds_frozen_at: epoch_ms
  detection_window_ms: int (a detection counts if |detected session_ms − labeled ms| ≤ this; proposed 15000)
  runs: uuid[] (recording ids, 12)
  per_run: [{ recording_id, step_recall, step_precision, skip_catch_rate, hazard_catch_rate, false_alarms, latencies_ms: int[] }]
  step_recall: number        // labeled completions matched by a step_completed within the window / labeled completions
  step_precision: number     // step_completed events matched by a label / step_completed events
  skip_catch_rate: number    // labeled skips with a step_unobserved before the next labeled completion / labeled skips
  hazard_catch_rate: number  // labeled violations with a hazard_violated before cleared_at_ms / labeled violations
  false_alarms_per_run: number // step_unobserved or hazard_violated events with no label within the window, per run
  latency_p50_ms: int, latency_p90_ms: int // over matched events: detected session_ms − labeled ms
}
```

The table is computed only by `scripts/measure` over the replay path; the in-app view renders this object and nothing else.

## Fixtures (E catalogs; everyone consumes)

`fixtures/<Contract>/<name>.json` holds a real captured instance that parses under the v1 schema. Day 1 gate captures at least: one `Tracks` (6 objects), one `Observation`, three `Utterance`, one `ProcedureDraft`, and the raw Meta responses they came from under `fixtures/raw/`. CI fails any import of `fixtures/` from `worker/` or `web/` (ATT-22).

## Changes to the spec this page makes

Each goes through the spec change log at kickoff (ATT-118) and is already reflected in the Day 1 prompts where it matters.

1. `ClientMessage.segment_ready` is removed; segment timing rides on the PUT as headers. One path for one fact.
2. `ClientMessage.resume` and `ServerMessage.segment_ack`, `closed`, `pong`, `error` are added; `session_state` is fully specified.
3. `GapEvent` is a named contract, not a `gap { n, reason }` message.
4. `Tracks` sends boxes only on the socket; masks stay in R2 (default until ATT-131 measures payload size).
5. `Session`, `ProcedureDraft` and `EventBase` are named contracts the table did not have.
6. Notes stay in one shared `AGENT_NOTES.md`, as the spec says, not `notes/<seat>.md` (Thomas's decision, Oct 26).
7. `Procedure.objects` has no cap: SAM is one concept per request, and the requests run in parallel, one per object (Thomas's decision, Oct 26).
