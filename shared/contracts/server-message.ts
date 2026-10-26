// WebSocket messages from the worker to the browser. session_state is always the first message
// after connect or resume; events follow in persistence order.
import { z } from "zod";
import { Confidence, EpochMs, HexColor, LanguageTag, MicroUsd, ObjectLabel, SegmentN, Uuid, words } from "./common";
import { ErrorBody } from "./error";
import { GapEvent, HazardEvent, StepEvent } from "./events";
import { ClosedReason, Session } from "./session";
import { Utterance } from "./utterance";

export const SERVER_MESSAGE_VERSION = 1;

const envelope = {
  v: z.literal(SERVER_MESSAGE_VERSION),
  server_at: EpochMs,
};

export const StepState = z.object({
  step_id: Uuid,
  state: z.enum(["pending", "active", "completed", "unobserved", "blocked"]),
  updated_ms: z.int(),
  event_id: Uuid.nullable(),
});
export type StepState = z.infer<typeof StepState>;

export const HazardState = z.object({
  rule_id: Uuid,
  state: z.enum(["armed", "satisfied", "violated", "cleared"]),
  updated_ms: z.int(),
  event_id: Uuid.nullable(),
});
export type HazardState = z.infer<typeof HazardState>;

export const SessionStateMessage = z.object({
  ...envelope,
  type: z.literal("session_state"),
  session: Session,
  procedure_id: Uuid,
  steps: z.array(StepState),
  hazards: z.array(HazardState),
  next_segment_n: SegmentN,
  last_event_id: Uuid.nullable(),
});

export const SegmentAckMessage = z.object({
  ...envelope,
  type: z.literal("segment_ack"),
  n: SegmentN,
  state: z.enum(["queued", "processing", "done", "gap"]),
});

// Pixel boxes only; masks stay server-side.
export const TrackBox = z.object({
  t_ms: z.int().nonnegative(),
  x1: z.int(),
  y1: z.int(),
  x2: z.int(),
  y2: z.int(),
});
export type TrackBox = z.infer<typeof TrackBox>;

export const TracksMessage = z.object({
  ...envelope,
  type: z.literal("tracks"),
  n: SegmentN,
  frame_w: z.int().positive(),
  frame_h: z.int().positive(),
  objects: z.array(
    z.object({
      label: ObjectLabel,
      color: HexColor,
      confidence: Confidence,
      boxes: z.array(TrackBox),
    }),
  ),
});

export const StepEventMessage = z.object({
  ...envelope,
  type: z.literal("step_event"),
  step_event: StepEvent,
});

export const HazardEventMessage = z.object({
  ...envelope,
  type: z.literal("hazard_event"),
  hazard_event: HazardEvent,
});

export const GapMessage = z.object({
  ...envelope,
  type: z.literal("gap"),
  gap: GapEvent,
});

export const UtteranceMessage = z.object({
  ...envelope,
  type: z.literal("utterance"),
  utterance: Utterance,
});

// The browser suppresses intents from utterances that overlap playback.
export const SayMessage = z.object({
  ...envelope,
  type: z.literal("say"),
  id: Uuid,
  text: words(40),
  language: LanguageTag,
  ref: z.object({
    kind: z.enum(["step", "hazard", "answer", "system"]),
    id: Uuid.nullable(),
  }),
  ends_listening_until_ms: z.int(),
});

export const SpendMessage = z.object({
  ...envelope,
  type: z.literal("spend"),
  session_micro_usd: MicroUsd,
  daily_micro_usd: MicroUsd,
  cap_micro_usd: MicroUsd,
});

export const ErrorMessage = z.object({
  ...envelope,
  type: z.literal("error"),
  error: ErrorBody,
});

export const PongMessage = z.object({
  ...envelope,
  type: z.literal("pong"),
  sent_at: EpochMs,
});

export const ClosedMessage = z.object({
  ...envelope,
  type: z.literal("closed"),
  reason: ClosedReason,
  report_url: z.string(),
});

export const ServerMessage = z.discriminatedUnion("type", [
  SessionStateMessage,
  SegmentAckMessage,
  TracksMessage,
  StepEventMessage,
  HazardEventMessage,
  GapMessage,
  UtteranceMessage,
  SayMessage,
  SpendMessage,
  ErrorMessage,
  PongMessage,
  ClosedMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
