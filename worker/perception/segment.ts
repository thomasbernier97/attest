// One segment through SAM and Spark in parallel: one SAM request per object of the segment's window
// and one Spark observe request on the same file_id. Spark reads the previous segment's tracks summary, so it never waits
// on this segment's SAM calls. Every call becomes a ModelCall row, whatever its outcome; any failed
// call makes the segment a gap.
import {
  MODEL_CALL_VERSION,
  type GapEvent,
  type ModelCall,
  type Observation,
  type Procedure,
  type Tracks,
} from "@attest/shared";
import { MetaApiError, type MetaClient } from "../meta/api";
import { callCost, usageNumber } from "../meta/cost";
import { SPARK_EFFORT } from "./config";
import { buildTracks, SAM_MODEL, trackObject, type SamCall, type SegmentInput } from "./sam";
import { observeSegment, SPARK_MODEL, type SparkCall } from "./spark";
import type { ObserveWindow } from "./state";

export interface SegmentJob {
  session_id: string;
  segment_n: number;
  file_id: string;
  fps: number;
  segment_ms: number;
  // The session's nominal segment length. Spark's prompt and schema use it rather than the measured
  // length, which varies by tens of ms, so they stay the same across segments and the cache hits.
  nominal_segment_ms: number;
  frame_w: number;
  frame_h: number;
  procedure: Procedure;
  state_text: string;
  window: ObserveWindow;
  recent_summaries: readonly string[];
  previous_tracks: string | null;
  timeout_ms: number;
}

export interface SegmentGap {
  reason: GapEvent["reason"];
  affected: GapEvent["affected"];
  detail: string;
}

export interface SegmentResult {
  tracks: Tracks | null;
  observation: Observation | null;
  calls: ModelCall[];
  gap: SegmentGap | null;
}

interface Failure {
  outcome: ModelCall["outcome"];
  error_code: string;
  reason: GapEvent["reason"];
}

export function classify(error: unknown): Failure {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return { outcome: "timeout", error_code: "timeout", reason: "model_timeout" };
  }
  if (error instanceof MetaApiError) {
    if (error.status === 429) return { outcome: "rate_limited", error_code: "http_429", reason: "rate_limited" };
    return { outcome: "error", error_code: `http_${String(error.status)}`, reason: "model_error" };
  }
  if (error instanceof TypeError) return { outcome: "error", error_code: "network", reason: "network" };
  return { outcome: "error", error_code: error instanceof Error ? error.name : "unknown", reason: "model_error" };
}

function modelCall(fields: Omit<ModelCall, "v" | "cost_micro_usd" | "idempotency_key">): ModelCall {
  const idempotency_key =
    fields.request_id === null
      ? `call:${String(fields.session_id)}:${fields.purpose}:${String(fields.segment_n)}:${fields.concept_label ?? "-"}:0`
      : `call:${fields.request_id}`;
  return { v: MODEL_CALL_VERSION, ...fields, cost_micro_usd: callCost(fields), idempotency_key };
}

function samRow(job: SegmentJob, call: SamCall): ModelCall {
  return modelCall({
    id: call.model_call_id,
    session_id: job.session_id,
    purpose: "track",
    model: SAM_MODEL,
    request_id: call.response_id,
    segment_n: job.segment_n,
    concept_label: call.label,
    started_at: call.started_at,
    latency_ms: call.latency_ms,
    tokens_in: 0,
    tokens_cached: 0,
    tokens_out: 0,
    media_units: usageNumber(call.usage, "video_frames_processed") ?? 0,
    media_unit_kind: "frames",
    outcome: "ok",
    error_code: null,
  });
}

function sparkRow(job: SegmentJob, call: SparkCall): ModelCall {
  return modelCall({
    id: call.model_call_id,
    session_id: job.session_id,
    purpose: "observe",
    model: SPARK_MODEL,
    request_id: call.response_id,
    segment_n: job.segment_n,
    concept_label: null,
    started_at: call.started_at,
    latency_ms: call.latency_ms,
    tokens_in: usageNumber(call.usage, "input_tokens") ?? 0,
    tokens_cached: usageNumber(call.usage, "input_tokens_details", "cached_tokens") ?? 0,
    tokens_out: usageNumber(call.usage, "output_tokens") ?? 0,
    media_units: 0,
    media_unit_kind: "none",
    outcome: "ok",
    error_code: null,
  });
}

function failedRow(job: SegmentJob, purpose: "track" | "observe", label: string | null, startedAt: number, failure: Failure): ModelCall {
  return modelCall({
    id: crypto.randomUUID(),
    session_id: job.session_id,
    purpose,
    model: purpose === "track" ? SAM_MODEL : SPARK_MODEL,
    request_id: null,
    segment_n: job.segment_n,
    concept_label: label,
    started_at: startedAt,
    latency_ms: Date.now() - startedAt,
    tokens_in: 0,
    tokens_cached: 0,
    tokens_out: 0,
    media_units: 0,
    media_unit_kind: purpose === "track" ? "frames" : "none",
    outcome: failure.outcome,
    error_code: failure.error_code,
  });
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown; started_at: number };

async function settle<T>(run: () => Promise<T>): Promise<Settled<T>> {
  const started_at = Date.now();
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error, started_at };
  }
}

// The procedure's objects that the window's steps and rules name, in procedure order.
export function windowObjects(procedure: Pick<Procedure, "objects">, window: ObserveWindow): Procedure["objects"] {
  return procedure.objects.filter((object) => window.object_labels.includes(object.label));
}

export async function runSegment(client: MetaClient, job: SegmentJob): Promise<SegmentResult> {
  const samInput: SegmentInput = {
    session_id: job.session_id,
    segment_n: job.segment_n,
    file_id: job.file_id,
    fps: job.fps,
    frame_count: Math.round((job.segment_ms * job.fps) / 1000),
    frame_w: job.frame_w,
    frame_h: job.frame_h,
    objects: windowObjects(job.procedure, job.window).map(({ label, prompt }) => ({ label, prompt })),
    timeout_ms: job.timeout_ms,
  };
  const started = Date.now();
  const samRuns = samInput.objects.map((object) =>
    settle(() => trackObject(client, job.file_id, object.label, object.prompt, job.timeout_ms)),
  );
  const sparkRun = settle(() =>
    observeSegment(client, {
      file_id: job.file_id,
      segment_ms: job.nominal_segment_ms,
      procedure: job.procedure,
      state: job.state_text,
      window: job.window,
      previous_tracks: job.previous_tracks,
      recent_summaries: job.recent_summaries,
      prompt_cache_key: `procedure:${job.procedure.id}`,
      effort: SPARK_EFFORT,
      timeout_ms: job.timeout_ms,
    }),
  );
  const samResults = await Promise.all(samRuns);
  const samLatency = Date.now() - started;
  const sparkResult = await sparkRun;

  const calls: ModelCall[] = [];
  const samCalls: SamCall[] = [];
  const failures: Failure[] = [];
  const affected: GapEvent["affected"] = [];
  const details: string[] = [];
  samResults.forEach((result, index) => {
    const label = samInput.objects[index]?.label ?? null;
    if (result.ok) {
      samCalls.push(result.value);
      calls.push(samRow(job, result.value));
    } else {
      const failure = classify(result.error);
      failures.push(failure);
      calls.push(failedRow(job, "track", label, result.started_at, failure));
      details.push(`SAM ${String(label)}: ${failure.error_code}`);
      if (!affected.includes("sam")) affected.push("sam");
    }
  });
  let observation: Observation | null = null;
  if (sparkResult.ok) {
    observation = sparkResult.value.observation;
    calls.push(sparkRow(job, sparkResult.value));
  } else {
    const failure = classify(sparkResult.error);
    failures.push(failure);
    calls.push(failedRow(job, "observe", null, sparkResult.started_at, failure));
    details.push(`Spark: ${failure.error_code}`);
    affected.push("spark");
  }

  const tracks = samCalls.length === samInput.objects.length ? buildTracks(samCalls, samInput, samLatency) : null;
  const first = failures[0];
  const gap = first === undefined ? null : { reason: first.reason, affected, detail: details.join("; ") };
  return { tracks, observation, calls, gap };
}

// What Spark reads about the previous segment: per object, how often SAM found it and where last.
export function tracksSummary(tracks: Tracks): string {
  return tracks.objects
    .map((object) => {
      const last = object.frames.at(-1);
      const where = last === undefined ? "not found" : `last box [${last.box.join(", ")}] at ${String(last.t_ms)} ms`;
      return `${object.label} in ${String(Math.round(object.present_ratio * 100))}% of frames, ${where}`;
    })
    .join("; ") + ` (frame ${String(tracks.frame_w)}x${String(tracks.frame_h)})`;
}
