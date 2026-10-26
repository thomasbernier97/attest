import { z } from "zod";
import { EpochMs, Uuid } from "./common";

export const RECORDING_VERSION = 1;
export const LABELS_VERSION = 1;

export const Scenario = z.enum(["clean", "skip", "hazard", "skip_and_hazard"]);

export const Recording = z.object({
  v: z.literal(RECORDING_VERSION),
  id: Uuid,
  // The live session that was recorded.
  source_session_id: Uuid,
  procedure_id: Uuid,
  procedure_hash: z.string(),
  // sessions/<source_session_id>/
  r2_prefix: z.string(),
  segment_count: z.int().nonnegative(),
  segment_ms: z.int().positive(),
  // Positive, not an integer: capture runs at 12.5 fps.
  fps: z.number().positive(),
  recorded_at: EpochMs,
  scenario: Scenario,
  notes: z.string(),
});
export type Recording = z.infer<typeof Recording>;

// Written by hand from the recording, never from Attest's own events.
export const Labels = z.object({
  v: z.literal(LABELS_VERSION),
  recording_id: Uuid,
  labeled_by: z.string(),
  labeled_at: EpochMs,
  steps: z.array(
    z.object({
      step_id: Uuid,
      // When the labeler judges the step done on video.
      completed_at_ms: z.int().nonnegative().nullable(),
      // When the next step visibly begins without it.
      skipped_at_ms: z.int().nonnegative().nullable(),
    }),
  ),
  hazards: z.array(
    z.object({
      rule_id: Uuid,
      violated_at_ms: z.int().nonnegative(),
      cleared_at_ms: z.int().nonnegative().nullable(),
    }),
  ),
  notes: z.string(),
});
export type Labels = z.infer<typeof Labels>;
