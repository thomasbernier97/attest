import { z } from "zod";
import { EpochMs, MicroUsd, Uuid } from "./common";

export const SESSION_VERSION = 1;

export const SessionKind = z.enum(["live", "replay"]);
export const SessionState = z.enum(["created", "running", "closed"]);
export const ClosedReason = z.enum(["completed", "worker", "operator", "spend_cap", "time_cap", "error"]);
export type ClosedReason = z.infer<typeof ClosedReason>;

export const Session = z.object({
  v: z.literal(SESSION_VERSION),
  id: Uuid,
  procedure_id: Uuid,
  kind: SessionKind,
  recording_id: Uuid.nullable(),
  state: SessionState,
  closed_reason: ClosedReason.nullable(),
  started_at: EpochMs.nullable(),
  ended_at: EpochMs.nullable(),
  segment_ms: z.int().positive(),
  // Positive, not an integer: capture runs at 12.5 fps.
  fps: z.number().positive(),
  time_cap_ms: z.int().positive(),
  spend_cap_micro_usd: MicroUsd,
  client: z.object({
    user_agent: z.string(),
    encoder: z.literal("webcodecs_h264"),
  }),
  consent_shown_at: EpochMs,
});
export type Session = z.infer<typeof Session>;
