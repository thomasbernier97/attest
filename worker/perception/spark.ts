// Segment observation with muse-spark-1.3: the segment video by file_id plus the procedure, answered
// as structured output under a JSON Schema built for that procedure. The reply names steps and rules
// by number and lists only those the segment shows something about (a step in_progress or
// completed, a rule satisfied or violated); the server maps it back to an Observation by id and
// validates that. Against the whole Observation by id, it halved the visible output and cut Spark's
// median from 7.1 to 5.6 s on 07aa1774's segments with the same judgments.
import { observationSchemaFor, WorkerActivity, words, type Observation, type Procedure } from "@attest/shared";
import { z } from "zod";
import { metaFetch, type MetaClient } from "../meta/api";

export const SPARK_MODEL = "muse-spark-1.3";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

// Word caps of the reply, the Observation's own.
const DESCRIPTION_WORDS = 12;
const SUMMARY_WORDS = 25;

// The parts of a procedure the observation prompt and schema use.
export type ObservedProcedure = Pick<Procedure, "title" | "starting_state" | "steps" | "objects" | "hazard_rules">;

export interface ObserveInput {
  file_id: string;
  segment_ms: number;
  procedure: ObservedProcedure;
  // Plain-text step states so far, from the state machine.
  state: string;
  // The steps and rules this segment asks about; the schema still allows every step and rule
  // number, so the cached prefix and the schema stay the same across segments.
  window: { step_ids: readonly string[]; rule_ids: readonly string[] };
  // The tracks summary of the latest earlier segment whose SAM calls had finished, naming that
  // segment; null when there is none.
  previous_tracks: string | null;
  // Summaries of the segments before this one, oldest first.
  recent_summaries: readonly string[];
  // One key per procedure, so segments share the cached prompt prefix; null sends none.
  prompt_cache_key: string | null;
  effort: ReasoningEffort;
  // Cap on output tokens, reasoning included; null sends none.
  max_output_tokens: number | null;
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

// The reply's schema: steps and rules by number, evidence fields inline.
export function replySchema(procedure: ObservedProcedure, segmentMs: number) {
  const labels = procedure.objects.map((object) => object.label);
  const [first, ...rest] = labels;
  const label = first === undefined ? z.string() : z.enum([first, ...rest]);
  const evidence = {
    confidence: z.number().min(0).max(1),
    object_labels: z.array(label),
    moment_ms: z.int().min(0).max(segmentMs),
    description: words(DESCRIPTION_WORDS),
  };
  const ruleCount = procedure.hazard_rules.length;
  const rules = z.array(z.object({ rule: z.int().min(1).max(Math.max(1, ruleCount)), state: z.enum(["satisfied", "violated"]), ...evidence }));
  const schema = z.object({
    summary: words(SUMMARY_WORDS),
    activity: WorkerActivity,
    steps: z.array(z.object({ step: z.int().min(1).max(procedure.steps.length), state: z.enum(["in_progress", "completed"]), ...evidence })),
    rules: ruleCount === 0 ? rules.max(0) : rules,
  });
  // The dialect key is not part of the schema Meta validates.
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(schema, { io: "output" }) };
  delete jsonSchema.$schema;
  return { schema, jsonSchema };
}

type Reply = z.infer<ReturnType<typeof replySchema>["schema"]>;

export function observePrompt(input: ObserveInput): string {
  const { procedure } = input;
  const steps = procedure.steps.map((step) => `${String(step.ordinal)}. ${step.instruction} Done when: ${step.completion_cue}`);
  const objects = procedure.objects.map((object) => `${object.label}: ${object.display_name}`);
  const rules = procedure.hazard_rules.map((rule, index) => `${String(index + 1)}: ${rule.condition} (${rule.severity})`);
  const ordinalOf = (id: string) => String(procedure.steps.find((step) => step.id === id)?.ordinal);
  const ruleNumberOf = (id: string) => String(procedure.hazard_rules.findIndex((rule) => rule.id === id) + 1);
  const list = (values: string[]) => (values.length === 0 ? "none" : values.join(", "));
  return [
    `You watch one ${String(input.segment_ms / 1000)}-second video segment of a worker at a bench following a written procedure.`,
    `Procedure: ${procedure.title}`,
    "Steps:",
    ...steps,
    "Objects (label: name):",
    ...objects,
    "Hazard rules:",
    ...(rules.length === 0 ? ["none"] : rules),
    `Before step 1 the camera sees: ${procedure.starting_state ?? "the text does not say."}`,
    "That starting arrangement completes no step and is no progress on any step: an object still lying where it started, or picked up and set down again, is not progress. Only a step whose Done when puts an object back where it started is completed by it.",
    "in_progress means this segment shows the worker doing that step's own action, with its end state partly in place. completed means the step's \"Done when\" holds at the end of this segment; a step the worker is still doing when the segment ends is in_progress. For a completed step, moment_ms is the first moment its \"Done when\" holds; for an in_progress step, the first moment the worker is seen doing it; for a hazard rule, the last moment its reported state is seen.",
    "A step none of whose objects the worker has touched or moved from where they started is not in_progress; leave it out.",
    "Report only what this segment shows. List a step only if this segment shows it in_progress or completed, and a hazard rule only if it shows the rule satisfied or violated; leave out everything else, and leave out what you cannot tell rather than guess. Steps and rules are given by their number.",
    `moment_ms is milliseconds from the start of this segment. The summary is at most ${String(SUMMARY_WORDS)} words; each description is at most ${String(DESCRIPTION_WORDS)} words.`,
    // Everything above is the same for every segment of a procedure, so it is the cached prefix.
    `This segment, report only on steps ${list(input.window.step_ids.map(ordinalOf))} and hazard rules ${list(input.window.rule_ids.map(ruleNumberOf))}; list no other step or rule.`,
    `State so far: ${input.state}`,
    `Earlier segments: ${input.recent_summaries.length === 0 ? "none" : input.recent_summaries.join(" | ")}`,
    `Tracks from an earlier segment: ${input.previous_tracks ?? "none"}`,
  ].join("\n");
}

// The reply by step and rule id, validated as an Observation of this procedure.
export function toObservation(procedure: ObservedProcedure, segmentMs: number, reply: Reply): Observation {
  const evidence = (entry: Reply["steps"][number] | Reply["rules"][number]) => ({
    object_labels: entry.object_labels,
    moment_ms: entry.moment_ms,
    description: entry.description,
  });
  const observation = {
    segment_summary: reply.summary,
    worker_activity: reply.activity,
    step_observations: reply.steps.map((entry) => ({
      step_id: procedure.steps.find((step) => step.ordinal === entry.step)?.id,
      state: entry.state,
      confidence: entry.confidence,
      evidence: evidence(entry),
    })),
    hazards: reply.rules.map((entry) => ({
      rule_id: procedure.hazard_rules[entry.rule - 1]?.id,
      state: entry.state,
      confidence: entry.confidence,
      evidence: evidence(entry),
    })),
  };
  const schema = observationSchemaFor({
    step_ids: procedure.steps.map((step) => step.id),
    rule_ids: procedure.hazard_rules.map((rule) => rule.id),
    object_labels: procedure.objects.map((object) => object.label),
    segment_ms: segmentMs,
  });
  const result = schema.safeParse(observation);
  if (!result.success) throw new SparkReplyError(`Spark observation failed validation: ${z.prettifyError(result.error)}`, reply);
  return result.data;
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
  const { schema, jsonSchema } = replySchema(input.procedure, input.segment_ms);
  const body = {
    model: SPARK_MODEL,
    reasoning: { effort: input.effort },
    ...(input.max_output_tokens === null ? {} : { max_output_tokens: input.max_output_tokens }),
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
    throw new SparkReplyError(`Spark reply failed validation: ${z.prettifyError(result.error)}`, raw);
  }
  let observation: Observation;
  try {
    observation = toObservation(input.procedure, input.segment_ms, result.data);
  } catch (error) {
    if (error instanceof SparkReplyError) throw new SparkReplyError(error.message, raw);
    throw error;
  }
  return {
    model_call_id: crypto.randomUUID(),
    response_id: parsed.id ?? null,
    started_at,
    latency_ms,
    usage: parsed.usage ?? null,
    observation,
    raw,
  };
}
