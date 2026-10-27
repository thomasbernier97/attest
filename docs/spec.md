# Attest — Canonical Build Spec v2 (Meta Global AI Developer Hackathon)

Oct 21, 2026 · @Thomas Bernier

This spec replaces v1 as canonical. Goal: win, or place top 3, in the Meta Global AI Developer Hackathon (Startup track, Push the Frontier). Every decision below traces to how judges score it.

## Pitch and the wow moment

**Pitch.** Attest (working name until Oct 21: Procedure Guardian) is a camera supervisor for physical work that attests, with evidence, that each step of a written procedure was done. Paste any written procedure, point a phone at the bench, and it watches: SAM 3.1 tracks every tool and part named in the procedure, Muse Spark confirms each step from the video as it happens, Muse Voice Transcribe lets the worker talk to it hands-free, and Muse Image shows what "done" looks like for each step. It catches skipped steps and safety violations within seconds and leaves behind an auditable record with clips, tracks and transcript. Manufacturers, maintenance teams, labs and kitchens already have written procedures and no way to prove they were followed; this is that proof, with guidance built in so workers want it running.

**The wow moment** (the whole build is sequenced to make this one scene reliable): the worker, mid-assembly, skips a step. On screen, tracked objects are outlined live; within 10 seconds a red marker lands on the timeline, the system speaks "Step 4 not observed, did you install the bracket?", the worker says "go back", does it, and the marker clears, with the 4-second clip that proved it. Then the worker reaches for the unit with power still connected and the system blocks the step before it can be marked done. The judge sees three Meta models do things only they can do, in one continuous live shot.

**Why it can win:** Push the Frontier asks for Meta's models meeting a physical system; the rubric weights impact, Meta tooling, technical depth and the demo equally. Almost every entry will be a text or coding agent. This one is a realtime multimodal pipeline on a physical process, with measured accuracy and latency, built and hardened by five parallel agents in nine days.

## Judging rubric

Confirmed by the Participant Guide published at kickoff (Oct 26): a pass/fail viability gate, then four criteria weighted equally and scored 0–10, the same for both tracks; the top 5 per track go to a final round where judges watch the demo videos live and rank them on the same rubric. The guide does not contain the legal terms (IP, publicity, consent, company entrants); those remain an open question in section 12.

| Stage or criterion | Weight | What judges ask | How Attest scores |
| --- | --- | --- | --- |
| Stage 1: viability | Pass/fail | Reasonable fit to a problem statement; Meta Model API or Meta open-weight models used to build it during the Hackathon | Push the Frontier: a camera that understands a written procedure and intervenes in physical work; four Meta models on the production path |
| Impact | 25% | Real-world potential, who benefits, whether people would actually use it, fit to a problem statement | Audit record with evidence for compliance-bound teams; replayable sessions; PDF/CSV/JSON export; works from any written procedure with no per-task training; the fan hazard framed as machine guarding; a real practitioner, if one agrees, in the video's close |
| Use of Meta AI Tooling | 25% | Creative use beyond a basic integration; capabilities that surprise Meta | SAM 3.1 text-prompted tracking from a pasted procedure, Muse Spark reasoning over 4-second video segments, Muse Voice Transcribe realtime turns, Muse Image step references; section 6 maps each to a feature |
| Technical Depth & Execution | 25% | Sound, refined engineering built with real craft | Ordered realtime pipeline with evidence on every event; deterministic state machine; measurement table from 12 labeled runs; degraded modes with no fabricated events; code and tests in the public repo |
| Demo | 25% | A working, impressive demo that holds up live; a video that is genuinely cool to watch | The live catch and the hazard block in one continuous take; live URL and hosted replays working through Nov 16 |
| Stage 3: final round | Same rubric | Top 5 per track; final judges watch the videos live and rank them | The video carries the case alone; no deck |
| Submission rules | Disqualifying | Public repo; three-minute video showing the features, code and functionality built during the Hackathon; everyone who worked listed; what was built during the event clearly identifiable | Section 11 package; new-work statement in the README, the description and the video |

**Weighting:** four equal criteria after a viability gate; the video is the primary judging artifact and the only one in the final round. Anything visible in the video or on the live URL comes first; hardening nobody sees counts only where it protects the live demo. Thomas's Day 9 and Day 10 time (rehearsal, filming, editing) is the most protected time in the plan.

## What makes it stand out

Four things most of the field will not have, each tied to a rubric row.

1. **Four Meta models, none swappable** (model depth). SAM 3.1's text-prompted video tracking is the only thing that turns "torque wrench" in a pasted procedure into a live outline with no training. Muse Spark is the only model that reads the 4-second clip, the tracks and a 1M-token session history in one call. Muse Voice Transcribe gives sub-second turns with turn detection over a socket. Muse Image makes the step references. Remove any one and a feature disappears.
2. **A physical process, live** (theme, demo impact). The demo is a real bench task under a real camera with a real skip and a real hazard, not a screen recording of a chat.
3. **Self-measured** (production). The system publishes its own accuracy and latency from labeled recordings, with thresholds frozen before measurement. Judges see numbers, and the honesty itself is a differentiator.
4. **Evidence on every event** (utility, execution). Each step and hazard event carries the clip, the tracked objects and the transcript turn that justified it. A compliance buyer can audit it; a judge can verify it.

**Deliberately not pursued:** on-device inference (adds days, judges score the hosted models), open-weights inference beyond the CP1-gated Muse Spark Open spike (ATT-123, ATT-140), multi-camera, and anything whose failure on stage would cost the wow moment.

## Capacity model

Five workstreams with contract-first interfaces, worked by Claude Code agent sessions; one human (Thomas) is the integrator, tester, reviewer, performer and editor, and his time is the scarce resource the schedule is built around.

**How the work runs** (from Oct 26). The five seats no longer run simultaneously. Work runs as single-unit agent sessions: one issue or one bounded step per session, each started by Thomas's GO; a push, dispatch, apply or DOWN ends the unit. Seat letters A to E remain as workstream areas that own directories and issues. Scope and tiers are unchanged. Every prompt follows the rule below.

### How to write a Flo agent prompt

**Scope.** One unit of work per session: one issue, or one bounded step with a single verifiable outcome. A push, dispatch, apply or DOWN ends a unit; each needs a fresh GO from Thomas, so never chain fix → push → CI → release in one prompt. If the steps don't fit on one screen (about 7), split the unit. The GOAL must be reachable using only the actions the unit allows; a goal that needs a push in a unit that forbids pushing will loop.

**Template (fixed order).** GOAL: one sentence plus why. READ FIRST: at most 5 sources (handoff Agent Note, Linear issue, files with paths). VERIFIED STATE: what was checked before writing the prompt, with ids (commit SHAs, run ids, issue ids, comment ids). STEPS: S0, S1, … each written as action → done-criterion → evidence required; S0 is always the branch sync (git fetch origin, fast-forward the local branch with --ff-only on a clean tree), done when the local and remote SHAs match the expected values, evidence SHAs and git status. OUT OF SCOPE: explicit list (e.g. push, dispatch, plan/apply, Linear or Notion writes). STOP AND ASK WHEN: a check fails; a finding is High or above; a choice no step covers; an instruction seems wrong (quote it). REPORT: every step id as done / not done / blocked with evidence, then findings to file, then questions; then end the session.

**/goal text.** Written separately from the prompt, for Claude Code's /goal. It describes the report that ends the session: which step evidence it contains, or the step where it stopped, plus what must not have happened (e.g. nothing pushed or applied). If a unit's plan changes mid-session, provide replacement /goal text.

**Length.** Prompt + /goal combined under 4000 characters, measured with a script (`printf '%s' "$TEXT" | wc -m`, not echo), with the count stated.

**Content rules.** Plain tone, reason stated; at most one line of emphasis, no all-caps or CRITICAL/MUST stacks. Every decision is made by Thomas and written into the prompt; never hand a decision to the agent through wording like "kept or squashed, and why". Tests exercise the real production path with real values; no placeholders or stubbed paths to make a test pass; new tests go red first, and each new check is shown catching a mutation. The agent runs a fresh-context reviewer on its diff before reporting; in a review loop, fix only reproduced Highs after the agreed last round and list the rest for a new unit. Anything that must never slip goes in a hook, guardrail or contract test, not just prose.

**State and sessions.** State lives where a cold session can read it: the handoff Agent Note, Linear, git, and a per-unit JSON checklist. The agent may set only status and evidence in the checklist, never add, remove or edit steps. Start a fresh session from the handoff after two corrections on the same issue or after any auto-compaction.

**Linear.** Writes happen only on Thomas's GO. The report lists every relation a write adds (Linear auto-links any issue id named in a comment or description). Remove one only on his decision.

**Rules that make parallelism real**

- Interface contracts (section 7) are written and committed on Day 1 before feature code; sessions build against the contracts, not against each other's branches.
- One repo, trunk `main`, short-lived branches per seat merged at least twice a day by Thomas; CI (typecheck, lint, unit tests) gates every merge.
- Each seat owns its directories; cross-seat edits go through a contract change and a message in the shared `AGENT_NOTES.md`.
- Every seat ends a session with a written handoff: what works on the deployed URL, what is stubbed behind a contract, what it needs from another seat.

**What parallelism does not speed up** (scheduled explicitly in section 8)

| Serial constraint | Why it is serial | Allocation |
| --- | --- | --- |
| Real-camera testing | One bench, one camera, one human; model behavior on real footage is unknowable until seen | 90 min every evening from Day 2; full afternoons on Days 5 and 6 |
| Model latency and quota | Meta's per-key rate limits and the $150 credit are shared by every agent session; a live segment round trip is 5 to 9 s no matter who waits | Credit budget: $60 development, $40 recordings and measurement, $30 live demo and judging, $20 reserve. Development uses recorded real API responses as fixtures in unit tests; only integration runs hit the API. Thomas adds a card on Day 1, before the first API call (Meta requires one even to spend the credit), so a cap never stops work; Meta's Billing spend limit only notifies, so the spend caps in code stay the only hard stop |
| Integration across workstreams | Contract drift shows only when real data crosses a boundary | Two merge windows daily (10:00 and 20:00 ET) plus three integration checkpoints (Days 3, 5, 7) with the whole pipeline live |
| Human review | Production-path code (session state, validators, token handling, deletion, webhooks) is reviewed by Thomas, with Seat E's independent review as the first pass | 2 h per day, 4 h on Days 8 and 9 |
| Recording labeled runs | 12 runs need Thomas at the bench with labels written by hand | Days 5 and 6 afternoons, Day 7 morning |
| Demo rehearsal and video | The wow moment must work live 5 times in a row before it is filmed; editing takes a day | Day 9 rehearsal and filming, Day 10 editing and submission |

**Freeze:** Day 1 is Oct 26 and Day 10 is Nov 4. Features freeze at the end of Day 8 (Nov 2, 18:00 ET), 48 hours before our internal deadline of Nov 4, 18:00 ET.

## Feature tiers

Tier 1 is the demo path and must be flawless; Tier 2 raises rubric scores; Tier 3 is what the slack buys if Tiers 1 and 2 land early. A tier past its cut-off is not started.

The "Rubric rows served" columns below predate the Oct 26 rubric. Read Execution and Production as Technical Depth & Execution, Model depth as Use of Meta AI Tooling, Utility and Theme as Impact, and Demo impact and Works as submitted as Demo.

**Tier 1, the core demo path. Cut-off: end of Day 5 (Oct 30). Must work live, every time.**

| Feature | Rubric rows served |
| --- | --- |
| Procedure compiler: pasted text → steps, objects, hazard rules, completion cues; operator approves | Execution, model depth |
| Live session from a browser: H.264 MP4 segments every 4 s, PCM audio, one WebSocket, reconnect | Execution, production |
| SAM 3.1 tracking of the procedure's objects per segment, live outlines drawn on the worker view | Model depth, demo impact |
| Muse Spark observation per segment (video + tracks + state, cached prefix, structured output) | Model depth, execution |
| Validator and state machine: completed / unobserved / hazard\_blocked with evidence; worker confirmation path | Production, utility |
| Voice: Muse Voice Transcribe realtime; intents next / done / repeat / go back / yes; spoken replies | Model depth, demo impact |
| Hazard rules: block the dependent step until the condition clears or the worker confirms | Demo impact, utility |
| Worker view and supervisor timeline with clips per event | Utility, demo impact |
| Deployed on `tryattest.dev` with Sentry, spend caps, rate limits, Access on operator routes | Production |

**Tier 2, score raisers. Cut-off: end of Day 7 (Nov 1).**

| Feature | Rubric rows served |
| --- | --- |
| Measurement harness: 12 labeled recordings replayed through the production path; accuracy and latency table published in-app with git SHA and model IDs | Production, honesty |
| Hosted replays of recorded runs (judges without a camera see everything) | Works as submitted |
| Muse Image reference image per step, shown as "what done looks like" | Model depth |
| Free-question answering mid-task (Muse Spark, 40-word spoken replies) | Demo impact |
| Procedure ingestion from a photo or PDF of an existing SOP (Muse Spark document and image understanding), not just pasted text | Model depth, utility |
| Session report: PDF/CSV/JSON export with evidence clips linked | Utility |
| Multilingual voice: worker speaks any of Muse Voice Transcribe's languages; replies in the same language | Model depth |
| Degraded modes shown in UI: gap markers, "model slow" state, never a fabricated event; chaos switch for the demo | Production |
| 5-session load run with results in the supervisor view | Production |
| Procedure compiler on Muse Wonder (muse-wonder-1.0) with Muse Spark 1.3 as fallback; an A/B on the demo SOP decides which is primary (ATT-122) | Model depth |
| Spike: Muse Spark Open on Baseten as the degraded-mode observe fallback; adopted only if the CP1 decision finds it does a real job (ATT-123, ATT-140) | Model depth |

**Tier 3, stretch. Cut-off: end of Day 8 (Nov 2, with the freeze). Only if Tier 2 is verified on the live URL.**

| Feature | Rubric rows served |
| --- | --- |
| Second demo procedure in a different domain (a kitchen or lab routine) to show generality | Utility, theme |
| Post-session narrated replay: Muse Spark narrates what went wrong over the clips | Demo impact |
| Procedure authoring by voice: dictate steps, the compiler structures them. Cut Oct 26 (ATT-96) | Model depth |
| Supervisor analytics across sessions: steps most often skipped, hazards most often triggered | Utility |
| Installable PWA for the worker view (phone on a mount) | Demo impact |

## Architecture and Meta model usage

One Cloudflare Worker (Hono) hosts the API, a Durable Object per session and the React SPA; D1 and R2 are the only stores; Meta is reached over the Model API (HTTPS) and one outbound realtime transcription WebSocket per session. No Next.js, no AWS, no queue service. The Worker runs on Workers Paid with limits.subrequests raised to 100,000, a cpu\_ms cap and a compatibility date of 2026-10-01 or later (confirmed in Cloudflare's docs at ATT-14).

&#91;embedded content: architecture: 1 Worker, 2 stores, 2 Meta endpoints\]

**Capture decision (from Meta's docs, checked today):** SAM 3.1 accepts MP4 or MOV with H.264, H.265 or MPEG-4 and rejects WebM and VP9 ([segmenting limits](https://dev.meta.ai/docs/sam/segmenting)). The browser therefore encodes H.264 with WebCodecs and muxes each 4-second segment into a standalone MP4 with mp4-muxer; MediaRecorder is not used. Segments are encoded at 12.5 fps (provisional until ATT-129), written as faststart MP4s and carry no audio track; audio travels separately as PCM. Each segment is uploaded once to R2 and once to Meta's Files API, and the returned file\_id is reused by SAM and Muse Spark, so a segment leaves the browser exactly once. Every Files API upload sets expires\_after (7 days), and the deletion job also deletes the segment's Meta file\_id.

**Per-feature model and API usage**

| Feature | Model and endpoint | Call shape | Notes |
| --- | --- | --- | --- |
| Procedure compiler | muse-spark-1.3, Responses API, reasoning effort high, text.format structured output; Tier 2 moves it to Muse Wonder (muse-wonder-1.0, ID to confirm in Meta's docs) with muse-spark-1.3 as fallback, kept only if an A/B on the demo SOP shows it at least as good (ATT-122) | Text (Tier 2: PDF or photo via input\_file) to steps, objects, hazard rules, cues | One call per procedure; operator approves the result |
| Object tracking | sam-3.1, video segmentation endpoint | file\_id plus one text concept per request, one request per procedure object, run in parallel (no cap on objects); box or point prompts carry each object forward, up to 16 instances per frame; per-frame boxes and masks | Billed per frame with a 50-frame minimum per request; segments captured at 12.5 fps (4 s = 50 frames), provisional until ATT-129 measures latency |
| Segment observation | muse-spark-1.3, Responses API, text.format structured output, prompt\_cache\_key per procedure with retention set, reasoning effort set from the Day 1 probe | Cached prefix (procedure, rules) plus state, last 3 summaries, the segment video and the previous segment's tracks summary (SAM and Spark run in parallel), to structured observations | One call per segment; 20 s timeout becomes a gap |
| Worker questions | muse-spark-1.3, Responses API, reasoning effort low | Procedure, state, transcript turn to a reply of at most 40 words plus an allowed action | Only for turns that match no keyword intent |
| Voice | muse-voice-transcribe-1.0, wss://api.meta.ai/v1/asr/realtime | 16 kHz PCM in; turns with timing out; turn detection on | Socket owned by the Session DO, which stays awake for the session (outbound sockets don't hibernate); key in the first JSON frame, audio paced in real time, ENDPOINTING mode, keywords bias the intent vocabulary; language auto-detected (Tier 2). Spoken replies use the browser's speechSynthesis with the same text on screen: the one non-Meta component, disclosed in the README (ATT-17, Oct 23) |
| Step references | muse-image-1.0, /v1/images/generations | Prompt from step instruction and objects to a PNG stored in R2 | Compile time, non-blocking |
| Narrated replay (Tier 3) | muse-spark-1.3, Responses API | Session events and clips to narration per event | Batch, after the session |

**Request path:** POST /api/sessions (Turnstile) returns a signed token; the browser opens wss /api/sessions/:id/ws, routed to the session's Durable Object. PUT /api/sessions/:id/segments/:n stores to R2, forwards to the Files API and notifies the DO. Inside the DO: ordered queue, then per segment SAM and Spark in parallel (Spark reads the previous segment's tracks summary), then validator and state machine; results are broadcast on the socket and written to D1 with clip keys. Replays feed a recording through the identical DO path with kind = replay.

**Non-negotiables:** Standard-mode model IDs only (muse-spark-1.3, sam-3.1, muse-voice-transcribe-1.0, muse-image-1.0, and muse-wonder-1.0 once ATT-122 confirms it), enforced at startup; no mocked providers on the production path; a step completes only with evidence from the current session.

## Workstreams per seat and interface contracts

Five workstreams, five directories, five owners; the contracts below are the only things two workstreams share, and they live in the shared package from Day 1.

| Seat | Workstream | Owns | Ships (Tier 1 → Tier 2 → Tier 3) |
| --- | --- | --- | --- |
| A | Platform and session core | `worker/` (Hono app, Session DO, D1 schema and migrations, R2, auth, Turnstile, rate limits, deploy, CI) | Session lifecycle, WebSocket protocol, segment upload and Files API forward, ordered queue, event persistence, replays; then deletion job, load harness; then analytics queries |
| B | Perception | `worker/perception/` (SAM client, Spark observe client, validators, state machine, prompts, measurement scorer) | Tracks per segment, observations, rules 1 to 5 with evidence; then measurement harness and scoring; then narrated replay |
| C | Procedure and voice | `worker/procedure/`, `worker/voice/` (compiler, Muse Image, ASR socket, intents, answer-worker) | Compiler and approval, voice intents, spoken replies; then PDF/photo ingestion, multilingual, free questions; then voice authoring |
| D | Front end | `web/` (worker view, supervisor timeline, replay player, capture pipeline with WebCodecs and mp4-muxer, audio worklet) | Capture and live views with SAM overlays; then replays, report export, degraded-state UI; then PWA, analytics views |
| E | Quality and release | `tests/`, `scripts/`, `docs/`, Sentry, security review, README, video storyboard, rules compliance | Unit and contract tests, Playwright replay test, chaos switch; then load run, measurement runs with Thomas, submission package; then final review |

**Thomas:** integration (merge windows), real-camera testing, recordings and labels, review sign-off, rehearsal, performance in the video, editing, submission.

**Interface contracts** (Zod schemas in `shared/contracts/`, versioned; a change is a PR that updates every consumer in the same merge; docs/contracts.md is the field-level authority and this table its summary)

| Contract | Producer → consumer | Shape (summary) |
| --- | --- | --- |
| `Procedure` | C → B, D | `{ id, steps[{ id, ordinal, instruction, expected_objects[], completion_cue, depends_on[], reference_image_key? }], objects[{ label, prompt }], hazard_rules[{ id, condition, before_step }] }` |
| `ClientMessage` (WebSocket up) | D → A | `segment_ready { n, r2_key, started_ms, duration_ms }`, `audio { pcm16 base64, ms }`, `worker_confirm { step_id, answer }`, `ping` |
| `ServerMessage` (WebSocket down) | A → D | `tracks { n, objects[{ label, boxes[] }] }`, `step_event`, `hazard_event`, `utterance`, `say { text }`, `gap { n, reason }`, `spend { session_usd }`, `session_state` |
| `Tracks` | B → B, D | `{ segment_n, objects[{ label, frames[{ t_ms, box, mask_key? }], confidence }] }` |
| `Observation` | Spark → B (validated) | `{ segment_summary, step_observations[{ step_id, state, confidence, evidence { object_labels[], moment_ms } }], hazards[{ rule_id, confidence, evidence }] }` |
| `StepEvent`, `HazardEvent` | B → A (persist), D (render) | `{ id, session_id, step_id or rule_id, type, segment_n, confidence, rationale, clip_key, detected_at_ms, latency_ms, idempotency_key }` |
| `Utterance` | C → A, B, D | `{ id, text, intent, started_ms, ended_ms, language }` |
| `ModelCall` | all → A (ledger) | `{ purpose, model, request_id, tokens_in, tokens_out, media_units, cost_micro_usd, latency_ms, outcome }` |
| `Recording` and `Labels` | E, Thomas → B | `{ id, r2_prefix, labels[{ step_id, completed_at_ms }], hazards[{ rule_id, at_ms }] }` |
| `MeasurementTable` | B → D, E | `{ sha, model_ids, runs, step_recall, step_precision, skip_catch_rate, hazard_catch_rate, false_alarms_per_run, latency_p50_ms, latency_p90_ms }` |

**Stub policy:** until a producer ships, consumers run against recorded real responses checked into `fixtures/` (captured on Day 1 from the live API). Fixtures are test inputs only; nothing on the deployed path ever reads them.

## Day-by-day schedule

The pipeline is live end to end by Day 3, Tier 1 is verified by Day 5, Tier 2 by Day 7, and nothing new starts after the Day 8 freeze.

&#91;embedded content: schedule, Days 1 to 10 (Oct 26 to Nov 4, 2026)\]

Merge windows at 10:00 and 20:00 ET every day; Thomas's camera session 20:30 to 22:00 from Day 2. CP = integration checkpoint, run by Thomas on the deployed URL with a real camera.

| Day | Seat A: platform | Seat B: perception | Seat C: procedure and voice | Seat D: front end | Seat E: quality | Thomas |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (Oct 26) | Public repo with the Apache-2.0 licence, CI with a gitleaks merge gate, deploy to tryattest.dev, D1 and R2 bindings, contracts package | Day 1 gate: real segment through SAM and Spark; capture fixtures; cost and latency logged | Gate: ASR socket turn from a PCM sample; compiler prompt v1 | WebCodecs H.264 segment encoder and upload; MP4 validated against SAM | Test scaffolding, fixtures catalog, Sentry wired, AGENT\_NOTES | Kickoff, keys, card on the Meta account before the first API call, approve contracts |
| 2 (Oct 27) | Session create, token, WebSocket, DO skeleton, segment ordering, persistence | SAM client, Spark observe client, Observation validator | Compiler with approval flow; Muse Image refs; intent matcher | Live worker view: camera, segments, socket, status | Contract tests for every schema; chaos switch | First camera test of capture and upload |
| 3 (Oct 28) | Replays through the DO path; rate limits, Turnstile | State machine rules 1 to 5 with evidence and clips | ASR in the DO; spoken replies; next, done, repeat, go back, yes | SAM overlays on live video; step list; hazard banner | Playwright replay test on deployed URL | CP1: a full segment loop live, step completes with clip |
| 4 (Oct 29) | Spend ledger and caps; Access on operator routes; exports API | Threshold tuning against first camera runs; gap handling | Hazard rules end to end; worker confirmation by voice | Supervisor timeline with clips and tracks; replay player | Security review pass 1 (token, socket, deletion) | Evening: skip and hazard scenarios live |
| 5 (Oct 30) | Load harness (5 sessions); deletion job | Measurement scorer and scripts/measure | Free-question answering; multilingual turn handling | Degraded-state UI; report view | Tier 1 acceptance run (section 9) | CP2: Tier 1 verified; record runs 1 to 4 |
| 6 (Oct 31) | Analytics queries (Tier 3 prep); fixes from CP2 | Replay all recordings; publish table v1; tune on runs 1 to 6, freeze thresholds | PDF and photo SOP ingestion | Export PDF, CSV, JSON; hosted replay gallery | Load run executed and recorded; README draft | Record runs 5 to 10; label |
| 7 (Nov 1) | Fixes; performance pass on DO and uploads | Measurement on runs 7 to 12; table v2 published in-app | Voice authoring cut (ATT-96); fixes | PWA and polish | Tier 2 acceptance run; video storyboard locked | CP3: Tier 2 verified; record runs 11 to 13 |
| 8 (Nov 2) | Second procedure support (Tier 3) until 18:00 | Narrated replay (Tier 3) until 18:00 | Prompt polish; stop at 18:00 | Analytics views until 18:00 | Freeze checklist; full acceptance sweep after 18:00 | Review 4 h; freeze at 18:00; first rehearsal |
| 9 (Nov 3) | Reviewed bug fixes only | Reviewed bug fixes only | Reviewed bug fixes only | Reviewed bug fixes only | Final security and rules review; description text | 5 clean rehearsals, then film the demo and B-roll |
| 10 (Nov 4) | On call | On call | On call | On call | Submission checklist; links verified logged out | Edit video, publish, post it on X, submit with the post link by 18:00 ET |

## Acceptance criteria per milestone

Every criterion is checked by Thomas on the deployed URL with a real camera; a seat's claim that something works is an input to the check, never the check.

**Day 1 gate** (end of Day 1)

- [ ] A 4-second H.264 MP4 encoded in the browser uploads, is accepted by the Files API, SAM 3.1 returns tracks for three prompted objects, and Muse Spark returns a validated observation for it.
- [ ] A realtime ASR turn arrives from the browser microphone through the Worker.
- [ ] Cost and latency per segment for SAM and Spark are logged in section 12; segment length and frame sampling are set from them.
- [ ] Contracts package merged; every seat has a fixture for what it consumes.
- [ ] Repo public with the licence file; the gitleaks scan gates merges in CI; a card is on the Meta account before the first API call.

**CP1: pipeline live** (Day 3)

- [ ] A fresh browser starts a session, streams segments and audio, and one step completes with a clip and tracks attached, live.
- [ ] Segment ordering survives a reconnect; a duplicate upload creates no duplicate event.
- [ ] Spoken "next" and "done" are recognized and answered aloud.

**CP2: Tier 1 verified** (Day 5)

- [ ] The 8-step demo procedure completes end to end with every step evidenced.
- [ ] Skipping a step raises unobserved within 15 s; "go back" and "yes" both resolve it.
- [ ] Both hazard rules block their dependent step and clear when resolved.
- [ ] Pulling the network for 20 s records a gap; no fabricated events; the session resumes.
- [ ] Seeded bad observations are rejected: unknown step, completion without tracked evidence, dependency violation, over-long reply.
- [ ] Startup fails with a contributor model ID; spend caps close a session cleanly; operator routes return 403 without Access.

**CP3: Tier 2 verified** (Day 7)

- [ ] Measurement table from all 12 labeled recordings is published in-app with SHA and model IDs, thresholds frozen after run 6.
- [ ] Hosted replays play for a logged-out visitor on phone and desktop.
- [ ] Step reference images show for every step; PDF or photo SOP ingestion produces an approvable procedure.
- [ ] A free question gets a spoken answer under 40 words within 5 s of the turn ending.
- [ ] 5 concurrent live sessions for 5 minutes: no 5xx, no cross-session leakage, p95 socket round trip under 300 ms.
- [ ] Report export (PDF, CSV, JSON) opens with clips linked.

**Freeze** (Day 8, 18:00 ET)

- [ ] Full acceptance sweep passes; Tier 3 items not green are disabled behind flags, not half-shipped.
- [ ] Independent review (Seat E, then Thomas) signed off on state machine, validators, token handling, deletion job.
- [ ] Detection latency p50 under 10 s and p90 under 15 s on the live path, or the real numbers are in the video script.

**Submission** (Day 10)

- [ ] Video public, under 3:00, shows the live catch, the hazard block, the measurement table, and the code and first-commit beat.
- [ ] README, description, public repo and live URL verified from a logged-out browser; no secrets anywhere.
- [ ] Public media deletion job confirmed against R2; the build is unchanged until Nov 9; the live URL and replay gallery stay up through Nov 16.
- [ ] New-work statement present in the README, the description and the video; X post published and its link entered; everyone who worked is listed on the submission page.

## Top risks

Each risk has a mitigation that is already in the plan and a fallback that keeps the demo honest; no fallback fakes a model call.

| Risk | Effect | Mitigation (in plan) | Fallback (if it still happens) |
| --- | --- | --- | --- |
| Model access: key, tier or feature gated (SAM video, realtime ASR, Files API) | Pipeline blocked | Day 1 gate exercises every endpoint before feature work; billing added so credits never gate | Image-mode SAM on sampled frames; Spark on image frames instead of video; keyword-only voice via browser speech recognition is NOT used (not a Meta model), so voice becomes push-to-talk upload to Muse Voice Transcribe batch |
| Latency: segment round trip over 12 s | The catch lands late; wow moment weakens | Low reasoning effort, cached prefix, 3 s segments if needed, SAM frame sampling, parallel upload to R2 and Files API | Publish the real p50/p90; stage the demo so the skip is caught before the next step finishes; never cut the step short in editing |
| Rate limits: agent sessions plus live sessions hit per-key RPM | 429s during development or demo | Dev uses recorded fixtures; one shared integration key with a client-side limiter in the DO; live mode capped to 2 concurrent sessions per IP | Replay-only public mode via one flag; demo runs on a dedicated key |
| Camera and lighting: tracks or observations fail on the real bench | Accuracy below usable | Fixed setup from Day 2 (overhead, matte surface, even light, objects with distinct colors); thresholds tuned on real runs; worker confirmation path | Simplify the procedure to steps with unambiguous cues; keep 8 steps but choose bigger, more distinct parts |
| Live-demo failure on film day | No wow moment | 5 clean rehearsals before filming; chaos switch tested; dedicated key and fresh session; two camera angles recorded | Film the best complete live take of several; never composite; the video states it is one live take |
| Browser encoding: WebCodecs H.264 unavailable on the demo device | No segments | Chrome on the workstation or Android as the demo browser; mp4 validated against SAM on Day 1 | Native MP4 MediaRecorder on Safari or iOS as the second device |
| Integration drift between workstreams | Days lost at checkpoints | Contracts first, fixtures from real responses, two merge windows a day, Thomas owns merges | A checkpoint that fails freezes the lagging seat on integration only until it passes |
| Credits exhausted | Model calls stop | Budget split in section 4; caps in code; paid billing attached Day 1 | Replay-only public mode; live demo on the reserve |
| New work not clearly identifiable (judges may disqualify), or the legal Official Rules conflict with the plan (IP, consent, company entrant) | Rework | Public repo from the first commit; new-work statement in the README, description and video; consent notice on every live page; legal terms checked on the Cerebral Valley platform before submission | Adjust package, not the product; the build is new work in a fresh repo by design |
| Thomas's time is the bottleneck | Checkpoints slip | Schedule allocates his hours explicitly; sessions write handoffs so review is fast | Drop Tier 3 entirely; protect recordings, rehearsal and video above all code |
| Secret leaked through the public repo | Key abuse; spend drained | Wrangler secrets only; full-history gitleaks scan gates every merge from Day 1; spend caps in code | Rotate the key at once, then purge history; replay-only public mode until rotated |

## Submission package

The video carries the case on its own; the live URL, public repo and README exist so a judge who looks deeper finds everything the video claimed.

**Demo script** (one continuous live take, about 2 minutes, filmed with the deployed app)

1. Procedure already approved on screen; camera on the bench; the worker says "start" and the session begins. SAM outlines appear on the gloves, fan, bracket, screwdriver, controller, power strip, tool tray and taped square. The procedure is `docs/demo-procedure.md`.
2. Steps 1 to 3 complete at natural pace (gloves on, fan flat in the taped square, screwdriver out of the tray); each lights up with its clip thumbnail. Gloves hazard rule shown satisfied at step 2.
3. Worker asks "what's next?" mid-motion; spoken answer within a couple of seconds.
4. Worker skips step 4 and starts step 5: the bracket stays on the mat while the fan stands up without it. Timeline marker turns red; system says "Step 4 not observed, did you install the bracket?" Worker says "go back", installs the bracket, marker clears.
5. Worker reaches to connect the fan cable while the power strip's switch is still lit. Hazard banner; step 6 blocked; worker switches the power strip off and its light goes out; banner clears; step completes.
6. Step 7 (power strip back on, fan blades spinning) and step 8 (screwdriver back in the tool tray) complete; session closes; report appears: 8 steps, 1 skipped then completed, 1 hazard averted, p50 latency, session cost.

**Video storyboard** (target 2:50, hard limit 3:00, public; the primary judging artifact and the only one in the final round)

| Time | Scene | On screen |
| --- | --- | --- |
| 0:00 | Hook | A signed paper checklist, then the question: did anyone actually do this? |
| 0:12 | Compile | Pasted procedure becomes steps, tracked objects, hazard rules, reference images (Muse Spark, Muse Image); voiceover states the core claim: any written procedure, no training data, no per-task model |
| 0:30 | Live take, part 1 | Demo script steps 1 to 3; SAM outlines live |
| 0:50 | Voice | "What's next?" and the answer (Muse Voice Transcribe) |
| 1:00 | The catch | Skip, flag, "go back", clear, with the evidence clip opened |
| 1:25 | Hazard | Blocked step, the power strip switched off (its light goes out), clear; one line framing the rule as machine guarding, with the fan standing in for a machine (check the current OSHA most-cited list before citing it) |
| 1:40 | Report | Timeline, evidence, latency and cost |
| 1:55 | Proof | Measurement table from 12 labeled runs; architecture diagram; the validator and state-machine code that decided the step; the public repo's first commit, after 12:00 ET Oct 26; Sentry, caps, load run; the chaos switch pulling a model mid-session with no fabricated event |
| 2:30 | Reach | Second-domain procedure (Tier 3) or the SOP photo ingestion, 10 seconds; which one is decided at CP2, and the second procedure comes forward only if Tier 1 holds |
| 2:40 | Close | What a supervisor gets; a real practitioner's words if one agrees (with permission, nothing invented); the core claim again; the live URL |

**README structure**

1. What it is, 3 sentences, with the live URL and the video, plus the core claim (works from any written procedure, with no training data and no per-task model) and one line stating that everything shown was built during the Hackathon.
2. The demo: how to open a hosted replay, how to run live with your own camera, the test procedure.
3. Meta models used, per feature, with endpoint and model IDs; non-Meta components and open-source dependencies named, so nothing reads as claimed work.
4. Architecture with the diagram.
5. Measured results and how they were produced (scripts/measure, labeled recordings, frozen thresholds).
6. Running locally (wrangler dev; secrets listed by name only).
7. Limits and known issues.
8. Team and build notes: Claude Code agent sessions, one unit of work each on Thomas's GO, contracts first, all code written inside the window (Oct 26, 12:00 ET to Nov 4); planning documents predate kickoff and are committed under docs/ with their original dates; Apache-2.0 licence.

**Description field** for the submission form: the pitch paragraph from section 1, the four model uses, the measured numbers, what is live vs recorded, the new-work statement, the public repo URL, the live URL, and the X post link.

**Repository:** public from the first commit, with the Apache-2.0 licence file in that commit; a full-history gitleaks scan gates every merge from Day 1. Secrets stay in wrangler secrets only. The public push history is the evidence that the work is new.

**Bonus prizes** (decided Oct 26): Most Viral ($20K, X engagement until Nov 8): post the demo video on X before submitting and enter the post link. Community Vote ($10K): share the gallery link. Best Agentic Use-Case ($5K): no extra work. Best Creative Build ($5K): not pursued. Best Build on Meta Open Weight Models ($10K): decided at CP1, and only if Muse Spark Open or Muse Glimmer does a real job in the product, not a fallback that never runs (ATT-123).

**After submission:** the live URL and the replay gallery stay up through Nov 16 (judging Nov 5 to 8, final round Nov 9, community vote to Nov 16); after Nov 9 public mode switches to replay-only to protect spend; the deletion job never touches the replay gallery.

## Open questions and change log

**Open questions** (each resolved here, in writing, before the work that depends on it)

- [x] Official Rules: the Participant Guide (published Oct 26) settles team size (max 4; solo allowed), new work, the public repo, the 3-minute video, judging and the final round; applied in sections 2, 4, 8, 9, 10 and 11.
- [ ] Entrant: Thomas as an individual or Flo Platforms, Inc. (prize payment, W-8BEN vs W-8BEN-E). Due before submission.
- [ ] Attest domain: tryattest.dev, purchased by Oct 26. Its zone goes in Flo's Cloudflare account and DNS must resolve before ATT-14 deploys to it.
- [ ] Demo kit confirmed: case fan, bracket, screws, screwdriver, USB fan controller, gloves; camera mount; a second device for filming. In hand by Oct 25.
- [ ] Paid billing on the Meta API key beyond the $150 credit: confirm the cap Thomas is willing to spend (recommended ceiling $200). A card must be on the account before the first API call; the $150 claim link is still pending (claim by Nov 4, 21:00 ET). Due Day 1.
- [ ] Day 1 measurements to log here: SAM video endpoint request shape, Files API reuse across SAM and Spark, tokens and cost per 4 s segment, observed latency per stage, ASR socket turn latency.
  - **First real clip, Oct 26** (`scripts/first-clip.ts`; fixtures in `fixtures/clips/`, `fixtures/raw/`, `fixtures/Tracks/`, `fixtures/Observation/`). One 4 s webcam clip of the bench (C920, MJPEG 1280x720 at 30 fps, re-encoded to H.264 High, yuv420p, 12.5 fps = 50 frames, faststart, no audio, 343 KB): fan, bracket and screwdriver in view, screwdriver picked up. Uploaded once; SAM and Spark ran in parallel on the same file\_id, twice (Spark effort minimal, then low). 9 Meta requests in all. ASR turn latency is not measured yet.
  - **Files API:** POST /v1/files, multipart, purpose user\_data, expires\_after\[anchor]=created\_at and expires\_after\[seconds]=604800; the reply's expires\_at is created\_at + 604800. Upload took 3,748 ms for 343 KB. **The file\_id is reused:** one upload served 6 SAM requests and 2 Spark requests across both runs.
  - **SAM request shape:** POST /v1/responses, `{ model: "sam-3.1", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: <one concept> }, { type: "input_video", file_id }] }], stream: true, metadata: { mask_encoding: "one_bit", include_confidence: "true" } }`, one request per object, in parallel. The stream sends one `response.output_text.delta` per frame that has a match: `<Nf>` then, per match, its ordinal and key=value tokens such as `0<|box;x1=724;y1=246;x2=886;y2=399;w=1280;h=720;c=0.94|><|mask;x=0;y=0;c=0.94;data=...|>`, in source pixels. Frames with no match send no line. N runs over every source frame (0 to 49); `response.completed` has `usage.video_frames_processed` = 50 and zero token counts. `c` is one value for the whole track, repeated on every frame, not a per-frame score. Raw stream: 31 to 77 KB per object per segment with one\_bit masks.
  - **Spark request shape:** POST /v1/responses, `reasoning.effort`, `prompt_cache_retention: "24h"`, one user message with the prompt then `{ type: "input_video", file_id }`, and `text.format = { type: "json_schema", name: "observation", schema, strict: true }` with the schema built per procedure from the shared Observation schema. Both replies parsed and validated. Cached tokens were 0 on the second call although the prefix was identical; no `prompt_cache_key` was sent.

    | Spark effort | Upload | SAM fan / bracket / screwdriver | SAM total | Spark | SAM and Spark wall | Spark tokens in / cached / out (reasoning) | SAM frames billed | Cost |
    | --- | --- | --- | --- | --- | --- | --- | --- | --- |
    | minimal | 3,748 ms | 4,538 / 3,778 / 3,918 ms | 4,539 ms | 3,782 ms | 4,542 ms | 1,336 / 0 / 377 (204) | 3 x 50 | $0.030000 SAM + $0.003273 Spark = $0.033273 |
    | low | reused | 3,226 / 3,662 / 3,731 ms | 3,750 ms | 7,200 ms | 7,225 ms | 1,336 / 0 / 1,095 (859) | 3 x 50 | $0.030000 SAM + $0.006324 Spark = $0.036324 |

  - **Matches per label (both runs):** fan in 50 of 50 frames (c 0.942, 0.945); screwdriver in 50 of 50 (c 0.942 both); bracket only in frames 35 to 49, 15 of 50 (c 0.719, 0.706), so the plain prompt "bracket" misses it for the first 2.8 s. Spark at both efforts marked "place fan and bracket" and "pick up the screwdriver" completed and did not claim the fastening step; low also reported it not\_observed. Both gave confidence 1.0 on completions and coarse `moment_ms` (500 or 1,000).
  - **Proposed from these numbers:** keep 4 s segments at 12.5 fps. 50 frames is exactly SAM's billing minimum, so a lower rate saves nothing and a higher one costs more. Spark effort minimal: same judgments here at about half the latency (3.8 s vs 7.2 s) and half the Spark cost. One segment then costs about $0.01 per object plus $0.003 for Spark, so $0.033 with 3 objects, about $0.50 per minute and $5 per 10-minute session (about $9.50 with 6 objects). SAM and Spark together take about as long as the segment (4.5 s for 4 s of video), and the upload adds 3.7 s, so the next segment's upload must overlap the current segment's processing or the queue grows. Two samples are not a p50: the latency measurement should repeat this on browser-made segments. Still to try: a more specific bracket prompt, `prompt_cache_key` for Spark caching, and box prompts to carry objects forward.
- [x] Resolved by the Oct 23 research: outbound WebSockets don't hibernate, so the Session DO stays awake for the session's 10-minute cap; ATT-39 confirms it on Day 2.
- [ ] Legal Official Rules (IP grant, publicity, recording consent, eligibility, company entrants and prize payment) are not in the Participant Guide: find the acceptance document on the Cerebral Valley platform, or ask in #questions. Due before submission; the entrant decision depends on it.
- [ ] Best Build on Meta Open Weight Models: pursue only if Muse Spark Open (meta-models/muse-spark-open-1026, via Baseten) or Muse Glimmer does a real job in the product; adopting it amends the standard-mode model list and the startup check. Request Baseten credits on Day 1 (capped at 2,000 participants). Due CP1 (Oct 28).
- [ ] Merge window vs office hours: Meta answers in Discord #office-hours 10:00 to 11:00 ET on weekdays, overlapping the 10:00 merge. Post questions before 10:00 and read answers after merging, or move the merge to 11:00. Due Day 2.
- [ ] Second procedure in the video's Reach beat: pull a short clip of a second domain forward from Tier 3 only if Tier 1 holds at CP2; otherwise the Reach beat shows SOP photo ingestion. Due CP2 (Oct 30).

**Decisions carried from v1 (unchanged):** separate fresh repo; Standard-mode models only; no mocked providers on the production path; simulated or recorded inputs always labeled; zero legacy; hosted in Flo's Cloudflare account on a purchased Attest domain (not a tryflo.dev subdomain).

**Decisions from the Participant Guide (Oct 26):** repo public from the first commit with Apache-2.0; deck cut (the final round watches videos only); Muse Code not adopted (ATT-124: it is not in the rubric); voice authoring stays cut (ATT-96: Impact is weighted the same as the other criteria); the open-weights bonus is decided at CP1.

**Change log** (newest first)

| Date | Change | Reason |
| --- | --- | --- |
| 2026-10-26 | Demo procedure approved and committed as `docs/demo-procedure.md`; demo script and storyboard follow it: the gloves rule is met at step 2 (was 3), the power hazard uses the power strip's lit switch instead of unplugging the controller, step 8 returns the screwdriver to the tool tray | Thomas approved the procedure text on Oct 26; the switch light is visible from overhead and off to connect, on to test reads as lockout |
| 2026-10-26 | First real clip through the Files API, SAM 3.1 and Muse Spark; numbers under Day 1 measurements. Contracts amended: `fps` is a positive number in Session, Tracks and Recording; a tracked object's `confidence` is null when no frame has a box; MeasurementTable rates are null when there was nothing to measure. Proposed: 4 s segments, 12.5 fps, Spark effort minimal. | The capture rate of 12.5 fps does not fit an integer; 0 of 0 and no boxes had no valid value; measured cost and latency |
| 2026-10-26 | Oct 23 research corrections applied (ATT-118). SAM: one concept per request, one request per object in parallel, no object cap, 50-frame billing minimum. Capture: 12.5 fps provisional until ATT-129, faststart, no audio track. SAM and Spark run in parallel; Spark reads the previous segment's tracks summary. Spark: text.format structured output, prompt\_cache\_key, effort from the Day 1 probe. Voice protocol details; spoken replies via speechSynthesis (decided Oct 23, ATT-17). Session DO stays awake (hibernation question resolved). Workers Paid limits and compatibility date. Files API expiry and file\_id deletion. Tier 2 gains the Muse Wonder compiler (ATT-122) and the Muse Spark Open spike (ATT-123); muse-wonder-1.0 joins the allowlist once confirmed. Voice authoring marked cut in the tables (ATT-96). Domain: tryattest.dev. Contracts v1 changes adopted (segment timing on the PUT, resume and acks, GapEvent, boxes-only tracks, Session, ProcedureDraft, EventBase), except: one AGENT\_NOTES.md instead of notes/\<seat>.md, and no cap on Procedure.objects. Not applied: the reported rubric weights (superseded by the Oct 26 rewrite) and the PWA and analytics cuts (kept). | Thomas's decisions on Oct 26; the spec is committed as docs/spec.md at kickoff (ATT-12) |
| 2026-10-26 | Operating model: the five seats no longer run simultaneously; work runs as single-unit agent sessions on Thomas's GO; seat letters stay as workstream areas; "How to write a Flo agent prompt" added under the capacity model | Thomas's decision at kickoff |
| 2026-10-26 | Impact strengthened within scope: the core claim (any written procedure, no training data, no per-task model) in the Compile beat, the close and README item 1; the hazard framed as machine guarding; a real practitioner in the close if one agrees; the second-procedure Reach clip decided at CP2; Impact rubric row updated | Impact is Attest's weakest of four equally weighted criteria; the fix is framing and evidence, not scope |
| 2026-10-26 | Participant Guide applied: rubric rewritten (viability gate, four equal criteria, video-only final round); repo public from the first commit with Apache-2.0 and a gitleaks merge gate; deck cut; video gains a code and first-commit beat; new-work statement in README, description and video; card before the first API call; live URL and replays kept up through Nov 16; bonus prizes decided; new risk (secret in the public repo); legal Official Rules, open-weights bonus and the office-hours overlap added as open questions | The guide published at kickoff settles judging, repo visibility, video length, team size and the final-round format; the reported 30/25/25/20 weights were wrong; disqualification is possible if new work is not clearly identifiable |
| 2026-10-23 | Oct 23 dev.meta.ai read (via Context7) recorded outside this doc: facts in Notion "Meta Model API facts (read Oct 23, 2026)" under Attest HQ; spec corrections on ATT-118; Day 1 experiments ATT-129 to ATT-132 | Docs contradict section 6 on SAM prompting (one concept per request, not 16 per call), make SAM frame cost the budget lever, and specify voice auth, PCM framing and turn events. Sections 4, 6 and 7 await Thomas's decision on concept cap and frame rate; Notion and Linear are the working record until kickoff. |
| 2026-10-21 | Product renamed Attest; hosted on a purchased Attest domain instead of a tryflo.dev subdomain | A name that states the buyer's outcome (proof the procedure was followed) |
| 2026-10-21 | v2 created; replaces v1 as canonical | Rubric-first rewrite, scope sized to five parallel seats, H.264 capture after SAM's WebM rejection was confirmed in Meta's docs, explicit serial-constraint scheduling and a 48-hour freeze |
