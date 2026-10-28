// What Muse Spark saw in one segment. Spark replies by step and rule number (worker/perception/
// spark.ts); the server maps the reply to ids and validates it with observationSchemaFor, so step
// ids, rule ids and labels are enums of that procedure's values.
import { z } from "zod";
import { Confidence, ObjectLabel, Uuid, words } from "./common";

export const OBSERVATION_VERSION = 1;

export const WorkerActivity = z.enum(["working", "idle", "hands_not_visible", "away"]);
export const StepObservationState = z.enum(["in_progress", "completed", "not_observed", "cannot_tell"]);
export const HazardObservationState = z.enum(["satisfied", "violated", "cannot_tell"]);

interface Fields {
  stepId: z.ZodType<string>;
  ruleId: z.ZodType<string>;
  label: z.ZodType<string>;
  // Upper bound of an evidence moment_ms; null when the segment length is not known.
  segmentMs: number | null;
  // False for a procedure with no hazard rules, which gets no hazard observations.
  hazardsAllowed: boolean;
}

function observationSchema(fields: Fields) {
  const moment = fields.segmentMs === null ? z.int().min(0) : z.int().min(0).max(fields.segmentMs);
  const hazards = z.array(
    z.object({
      rule_id: fields.ruleId,
      state: HazardObservationState,
      confidence: Confidence,
      evidence: z.object({
        object_labels: z.array(fields.label),
        moment_ms: moment,
        description: words(12),
      }),
    }),
  );
  return z.object({
    segment_summary: words(25),
    worker_activity: WorkerActivity,
    step_observations: z.array(
      z.object({
        step_id: fields.stepId,
        state: StepObservationState,
        confidence: Confidence,
        evidence: z.object({
          object_labels: z.array(fields.label),
          moment_ms: moment,
          description: words(12),
        }),
      }),
    ),
    hazards: fields.hazardsAllowed ? hazards : hazards.max(0),
  });
}

// The procedure-independent shape: ids are UUIDs, labels are slugs.
export const Observation = observationSchema({
  stepId: Uuid,
  ruleId: Uuid,
  label: ObjectLabel,
  segmentMs: null,
  hazardsAllowed: true,
});
export type Observation = z.infer<typeof Observation>;

export interface ObservationValues {
  step_ids: readonly string[];
  rule_ids: readonly string[];
  object_labels: readonly string[];
  segment_ms: number;
}

function oneOf(values: readonly string[], fallback: z.ZodType<string>): z.ZodType<string> {
  const [first, ...rest] = values;
  return first === undefined ? fallback : z.enum([first, ...rest]);
}

export function observationSchemaFor(values: ObservationValues) {
  return observationSchema({
    stepId: oneOf(values.step_ids, Uuid),
    ruleId: oneOf(values.rule_ids, Uuid),
    label: oneOf(values.object_labels, ObjectLabel),
    segmentMs: values.segment_ms,
    hazardsAllowed: values.rule_ids.length > 0,
  });
}
