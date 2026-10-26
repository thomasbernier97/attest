import { z } from "zod";
import { EpochMs, MicroUsd, ModelId, ObjectLabel, SegmentN, Uuid } from "./common";

export const MODEL_CALL_VERSION = 1;

export const ModelCallPurpose = z.enum(["compile", "track", "observe", "answer", "transcribe", "image", "narrate"]);
export const MediaUnitKind = z.enum(["frames", "images", "audio_seconds", "none"]);
export const ModelCallOutcome = z.enum(["ok", "timeout", "error", "rate_limited", "spend_cap"]);

export const ModelCall = z.object({
  v: z.literal(MODEL_CALL_VERSION),
  id: Uuid,
  // Null for compile and image calls made outside a session.
  session_id: Uuid.nullable(),
  purpose: ModelCallPurpose,
  model: ModelId,
  // Meta's request id.
  request_id: z.string().nullable(),
  segment_n: SegmentN.nullable(),
  // Track calls only.
  concept_label: ObjectLabel.nullable(),
  started_at: EpochMs,
  latency_ms: z.int().nonnegative(),
  tokens_in: z.int().nonnegative(),
  tokens_cached: z.int().nonnegative(),
  tokens_out: z.int().nonnegative(),
  media_units: z.int().nonnegative(),
  media_unit_kind: MediaUnitKind,
  // From shared/pricing.ts; recomputed from the row, never trusted from the caller.
  cost_micro_usd: MicroUsd,
  outcome: ModelCallOutcome,
  error_code: z.string().nullable(),
  idempotency_key: z.string(),
});
export type ModelCall = z.infer<typeof ModelCall>;
