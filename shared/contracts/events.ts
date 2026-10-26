// Step, hazard and gap events share one base and one table.
import { z } from "zod";
import { Confidence, EpochMs, SegmentN, Uuid, words } from "./common";

export const EVENT_VERSION = 1;

export const EventSource = z.enum(["observation", "tracks", "worker_confirm", "rule", "system"]);

export const EventBase = z.object({
  v: z.literal(EVENT_VERSION),
  id: Uuid,
  session_id: Uuid,
  segment_n: SegmentN,
  detected_at: EpochMs,
  session_ms: z.int(),
  // detected_at minus the wall-clock end of segment_n.
  latency_ms: z.int(),
  source: EventSource,
  confidence: Confidence.nullable(),
  rationale: words(40),
  // R2 key of the segment MP4; null only on gaps with no segment.
  clip_key: z.string().nullable(),
  tracks_segment_n: SegmentN.nullable(),
  utterance_id: Uuid.nullable(),
  idempotency_key: z.string(),
});
export type EventBase = z.infer<typeof EventBase>;

export const StepEvent = EventBase.extend({
  type: z.enum([
    "step_completed",
    "step_unobserved",
    "step_resumed",
    "step_confirmed_done",
    "step_confirmed_not_done",
  ]),
  step_id: Uuid,
});
export type StepEvent = z.infer<typeof StepEvent>;

export const HazardEvent = EventBase.extend({
  type: z.enum(["hazard_satisfied", "hazard_violated", "hazard_cleared"]),
  rule_id: Uuid,
  blocked_step_id: Uuid.nullable(),
});
export type HazardEvent = z.infer<typeof HazardEvent>;

export const GapReason = z.enum(["model_timeout", "model_error", "rate_limited", "upload_missing", "network", "spend_cap"]);
export const GapSubsystem = z.enum(["sam", "spark", "asr", "upload"]);

export const GapEvent = EventBase.extend({
  type: z.literal("gap"),
  reason: GapReason,
  affected: z.array(GapSubsystem),
  ended_at: EpochMs.nullable(),
});
export type GapEvent = z.infer<typeof GapEvent>;

export const TimelineEvent = z.discriminatedUnion("type", [StepEvent, HazardEvent, GapEvent]);
export type TimelineEvent = z.infer<typeof TimelineEvent>;
