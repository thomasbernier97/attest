// Segment observation with muse-spark-1.3: the segment video by file_id plus the procedure, answered
// as structured output under a JSON Schema built for that procedure, then validated.
import { observationSchemaFor, type Observation, type Procedure } from "@attest/shared";
import { z } from "zod";
import { metaFetch, type MetaClient } from "../meta/api";

export const SPARK_MODEL = "muse-spark-1.3";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

// The parts of a procedure the observation prompt and schema use.
export type ObservedProcedure = Pick<Procedure, "title" | "steps" | "objects" | "hazard_rules">;

export interface ObserveInput {
  file_id: string;
  segment_ms: number;
  procedure: ObservedProcedure;
  // Plain-text step states so far, from the state machine.
  state: string;
  // The previous segment's tracks summary; null for the first segment.
  previous_tracks: string | null;
  // Summaries of the segments before this one, oldest first.
  recent_summaries: readonly string[];
  // One key per procedure, so segments share the cached prompt prefix; null sends none.
  prompt_cache_key: string | null;
  effort: ReasoningEffort;
  timeout_ms: number;
}

export interface SparkCall {
  model_call_id: string;
  response_id: string | null;
  started_at: number;
  latency_ms: number;
  usage: Record<string, unknown> | null;
  observation: Observation;
  // The response body as received.
  raw: unknown;
}

export function observationJsonSchema(procedure: ObservedProcedure, segmentMs: number) {
  const schema = observationSchemaFor({
    step_ids: procedure.steps.map((step) => step.id),
    rule_ids: procedure.hazard_rules.map((rule) => rule.id),
    object_labels: procedure.objects.map((object) => object.label),
    segment_ms: segmentMs,
  });
  // The dialect key is not part of the schema Meta validates.
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema, { io: "output" }) };
  delete jsonSchema.$schema;
  return { schema, jsonSchema };
}

export function observePrompt(input: ObserveInput): string {
  const { procedure } = input;
  const steps = procedure.steps.map(
    (step) => `${String(step.ordinal)}. id ${step.id}: ${step.instruction} Done when: ${step.completion_cue}`,
  );
  const objects = procedure.objects.map((object) => `${object.label}: ${object.display_name}`);
  const rules = procedure.hazard_rules.map((rule) => `id ${rule.id}: ${rule.condition} (${rule.severity})`);
  return [
    `You watch one ${String(input.segment_ms / 1000)}-second video segment of a worker at a bench following a written procedure.`,
    `Procedure: ${procedure.title}`,
    "Steps:",
    ...steps,
    "Objects (label: name):",
    ...objects,
    "Hazard rules:",
    ...(rules.length === 0 ? ["none"] : rules),
    "Report only what this segment shows. Give a step observation only for a step this segment shows evidence about; use cannot_tell instead of guessing.",
    "moment_ms is milliseconds from the start of this segment. segment_summary is at most 60 words; each evidence description is at most 25 words.",
    // Everything above is the same for every segment of a procedure, so it is the cached prefix.
    `State so far: ${input.state}`,
    `Earlier segments: ${input.recent_summaries.length === 0 ? "none" : input.recent_summaries.join(" | ")}`,
    `Previous segment's tracks: ${input.previous_tracks ?? "none"}`,
  ].join("\n");
}

// A reply that arrived but could not be used; carries the body for the record.
export class SparkReplyError extends Error {
  readonly raw: unknown;

  constructor(message: string, raw: unknown) {
    super(message);
    this.name = "SparkReplyError";
    this.raw = raw;
  }
}

export interface ResponseBody {
  id?: string;
  status?: string;
  usage?: Record<string, unknown>;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
}

export function outputText(body: ResponseBody): string {
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  throw new SparkReplyError("Spark response has no output_text", body);
}

export async function observeSegment(client: MetaClient, input: ObserveInput): Promise<SparkCall> {
  const { schema, jsonSchema } = observationJsonSchema(input.procedure, input.segment_ms);
  const body = {
    model: SPARK_MODEL,
    reasoning: { effort: input.effort },
    ...(input.prompt_cache_key === null ? {} : { prompt_cache_key: input.prompt_cache_key }),
    prompt_cache_retention: "24h",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: observePrompt(input) },
          { type: "input_video", file_id: input.file_id },
        ],
      },
    ],
    text: { format: { type: "json_schema", name: "observation", schema: jsonSchema, strict: true } },
  };
  const started_at = Date.now();
  const response = await metaFetch(client, "/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(input.timeout_ms),
  });
  const raw: unknown = await response.json();
  const latency_ms = Date.now() - started_at;
  const parsed = raw as ResponseBody;
  if (parsed.status !== undefined && parsed.status !== "completed") {
    throw new SparkReplyError(`Spark response status is ${parsed.status}`, raw);
  }
  let reply: unknown;
  try {
    reply = JSON.parse(outputText(parsed));
  } catch (error) {
    if (error instanceof SparkReplyError) throw error;
    throw new SparkReplyError("Spark output_text is not JSON", raw);
  }
  const result = schema.safeParse(reply);
  if (!result.success) {
    throw new SparkReplyError(`Spark observation failed validation: ${z.prettifyError(result.error)}`, raw);
  }
  return {
    model_call_id: crypto.randomUUID(),
    response_id: parsed.id ?? null,
    started_at,
    latency_ms,
    usage: parsed.usage ?? null,
    observation: result.data,
    raw,
  };
}
