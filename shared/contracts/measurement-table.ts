// Computed only by the measurement script over the replay path; the in-app view renders this
// object and nothing else.
import { z } from "zod";
import { EpochMs, ModelId, Uuid } from "./common";

export const MEASUREMENT_TABLE_VERSION = 1;

const Rate = z.number().min(0).max(1);

export const RunMeasurement = z.object({
  recording_id: Uuid,
  step_recall: Rate,
  step_precision: Rate,
  skip_catch_rate: Rate,
  hazard_catch_rate: Rate,
  false_alarms: z.int().nonnegative(),
  latencies_ms: z.array(z.int()),
});
export type RunMeasurement = z.infer<typeof RunMeasurement>;

export const MeasurementTable = z.object({
  v: z.literal(MEASUREMENT_TABLE_VERSION),
  computed_at: EpochMs,
  // Git commit.
  sha: z.string(),
  model_ids: z.object({ spark: ModelId, sam: ModelId, voice: ModelId }),
  thresholds_version: z.string(),
  thresholds_frozen_at: EpochMs,
  // A detection counts if |detected session_ms - labeled ms| is at most this.
  detection_window_ms: z.int().positive(),
  // Recording ids.
  runs: z.array(Uuid),
  per_run: z.array(RunMeasurement),
  step_recall: Rate,
  step_precision: Rate,
  skip_catch_rate: Rate,
  hazard_catch_rate: Rate,
  false_alarms_per_run: z.number().nonnegative(),
  latency_p50_ms: z.int(),
  latency_p90_ms: z.int(),
});
export type MeasurementTable = z.infer<typeof MeasurementTable>;
