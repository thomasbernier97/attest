// Procedure compiler: written procedure text to a ProcedureDraft with muse-spark-1.3 at reasoning
// effort high, answered as structured output under the shared ProcedureDraft schema, then validated.
// A reply that does not validate is rejected with its body; it is never repaired.
import { MODEL_CALL_VERSION, ProcedureDraft, type ModelCall } from "@attest/shared";
import { z } from "zod";
import { metaFetch, type MetaClient } from "../meta/api";
import { callCost, usageNumber } from "../meta/cost";
import { classify } from "../perception/segment";
import { outputText, SPARK_MODEL, SparkReplyError, type ResponseBody } from "../perception/spark";

// A compile call that takes longer is abandoned; the reader at effort high took 42 s on the demo procedure.
export const COMPILE_TIMEOUT_MS = 300_000;
// Longest procedure text the compiler accepts, which bounds its input tokens.
export const MAX_SOURCE_CHARS = 20_000;
// Worst-case usage of one compile call, for the spend check before it is sent.
export const COMPILE_WORST_CASE_TOKENS = { tokens_in: 10_000, tokens_out: 32_000 };

export interface CompileInput {
  text: string;
  timeout_ms: number;
}

export interface CompileCall {
  model_call_id: string;
  response_id: string | null;
  started_at: number;
  latency_ms: number;
  usage: Record<string, unknown> | null;
  draft: ProcedureDraft;
  // The response body as received.
  raw: unknown;
}

export function procedureDraftJsonSchema(): Record<string, unknown> {
  // The dialect key is not part of the schema Meta validates.
  const jsonSchema: Record<string, unknown> = { ...z.toJSONSchema(ProcedureDraft, { io: "output" }) };
  delete jsonSchema.$schema;
  return jsonSchema;
}

export function compilePrompt(text: string): string {
  return [
    "You turn a written work procedure into a draft that a camera supervisor runs. A fixed overhead camera watches a worker at a bench.",
    "SAM tracks each object from its prompt, and a vision model judges each step from 4-second video segments.",
    "Rules for each field:",
    "- v is 1. title: the procedure's own title, at most 120 characters. language: the BCP-47 tag of the text.",
    "- steps: one step per numbered step in the text, in the same order, ordinal from 1. instruction: the step as the worker reads it, at most 240 characters.",
    "- completion_cue: the end state that shows the step is done, as the camera sees it, and that stays visible after the step; use the text's \"Done when\" when it gives one. At most 160 characters.",
    "- cue_kind: object_placed (an object is put somewhere), object_state (an object changes state: fastened, plugged in, switched, spinning), object_motion, tool_use, or worker_action (something the worker does or wears).",
    "- expected_objects: the labels (at most 4) of the objects the camera must see to judge the step.",
    "- depends_on: only the ordinals of earlier steps this step physically needs, because it uses something an earlier step installs or prepares. Do not list a step only because it comes earlier. Empty when none.",
    "- objects: one object per physical thing the camera must find to judge a completion cue or a hazard condition: tools, parts, containers, equipment and work-area markings. Small parts such as screws and cables are judged on the object they attach to and get no object of their own. label: a snake_case slug. display_name: a short name.",
    "- prompt: the SAM prompt for that one object: a concrete noun phrase of 1 to 6 words naming one thing, with its colour or material when the text gives it. No verbs, no states, no two objects with the same prompt.",
    "- hazard_rules: exactly one rule per safety rule in the text, and no others.",
    "- condition: the safe state the safety rule requires, stated so the camera can check it in any segment: the rule is satisfied when the state holds and violated when it does not. At most 160 characters.",
    "- condition_kind: object_present, object_absent or object_state; an object being worn, held, switched or lit is object_state. object_label: the object the camera checks for the condition. before_step: the step ordinal the safety rule names.",
    "- severity: block when the safety rule must stop the step, warn otherwise. message: what the system says to the worker when the rule is violated, at most 20 words.",
    "Procedure text:",
    "<<<",
    text.trim(),
    ">>>",
  ].join("\n");
}

export async function compileProcedure(client: MetaClient, input: CompileInput): Promise<CompileCall> {
  const body = {
    model: SPARK_MODEL,
    reasoning: { effort: "high" },
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: compilePrompt(input.text) }] }],
    text: { format: { type: "json_schema", name: "procedure_draft", schema: procedureDraftJsonSchema(), strict: true } },
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
  // The schema's refinements carry the contract's cross-checks: ordinals 1..n, unique labels, every
  // expected_objects and object_label an existing object, depends_on lower ordinals, before_step an
  // existing step, and the word caps on prompt and message.
  const result = ProcedureDraft.safeParse(reply);
  if (!result.success) {
    throw new SparkReplyError(`Spark procedure draft failed validation: ${z.prettifyError(result.error)}`, raw);
  }
  return {
    model_call_id: crypto.randomUUID(),
    response_id: parsed.id ?? null,
    started_at,
    latency_ms,
    usage: parsed.usage ?? null,
    draft: result.data,
    raw,
  };
}

// The ModelCall row for a compile call. A call that failed has its usage when Spark answered and
// the answer was rejected, and none otherwise.
export function compileCallRow(
  call: { model_call_id: string; response_id: string | null; started_at: number; latency_ms: number; usage: Record<string, unknown> | null },
  failure: unknown = null,
): ModelCall {
  const usage = {
    model: SPARK_MODEL,
    tokens_in: usageNumber(call.usage, "input_tokens") ?? 0,
    tokens_cached: usageNumber(call.usage, "input_tokens_details", "cached_tokens") ?? 0,
    tokens_out: usageNumber(call.usage, "output_tokens") ?? 0,
    media_units: 0,
    media_unit_kind: "none",
  } as const;
  const failed = failure === null ? null : classify(failure);
  return {
    v: MODEL_CALL_VERSION,
    id: call.model_call_id,
    session_id: null,
    purpose: "compile",
    request_id: call.response_id,
    segment_n: null,
    concept_label: null,
    started_at: call.started_at,
    latency_ms: call.latency_ms,
    ...usage,
    outcome: failed?.outcome ?? "ok",
    error_code: failed?.error_code ?? null,
    cost_micro_usd: callCost(usage),
    // Without Meta's request id, the attempt part of the key is the call's own id.
    idempotency_key: call.response_id === null ? `call:null:compile:null:-:${call.model_call_id}` : `call:${call.response_id}`,
  };
}
