// Runs one recorded clip through the Files API, sam-3.1 and muse-spark-1.3, the way the Session DO
// will run a segment: one upload, then SAM and Spark in parallel on the same file_id. Prints latency
// per stage, tokens, frames, cost and matches per label, and saves the raw responses and the parsed
// Tracks and Observation under fixtures/.
// Usage: META_API_KEY=... pnpm tsx scripts/first-clip.ts --run <name> --effort minimal|low
//          --max-requests <n> [--file-id <id>] [--clip fixtures/clips/first-clip.mp4]
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { PRICES } from "../shared/pricing.ts";
import { MetaApiError } from "../worker/meta/api.ts";
import { uploadFile } from "../worker/meta/files.ts";
import { trackSegment, type SamCall } from "../worker/perception/sam.ts";
import { observeSegment, SparkReplyError, type ObservedProcedure, type ReasoningEffort, type SparkCall } from "../worker/perception/spark.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const SPARK_TIMEOUT_MS = 120_000;
const SAM_TIMEOUT_MS = 120_000;

// The bench procedure the clip shows the start of.
const PROCEDURE: ObservedProcedure = {
  title: "Fasten the bracket to the case fan",
  steps: [
    {
      id: "890fdff7-c650-440c-aec8-0a85a5cac322",
      ordinal: 1,
      instruction: "Place the case fan and the bracket on the bench.",
      expected_objects: ["fan", "bracket"],
      completion_cue: "The fan and the bracket lie on the bench in view.",
      cue_kind: "object_placed",
      depends_on: [],
      reference_image_key: null,
    },
    {
      id: "15fc0526-ba92-4362-8b39-905334a55cd0",
      ordinal: 2,
      instruction: "Pick up the screwdriver.",
      expected_objects: ["screwdriver"],
      completion_cue: "The screwdriver is in the worker's hand.",
      cue_kind: "tool_use",
      depends_on: ["890fdff7-c650-440c-aec8-0a85a5cac322"],
      reference_image_key: null,
    },
    {
      id: "98418985-1d3b-484d-a734-b9395c7a1fb6",
      ordinal: 3,
      instruction: "Screw the bracket to the fan.",
      expected_objects: ["fan", "bracket", "screwdriver"],
      completion_cue: "The bracket is fastened to the fan with screws.",
      cue_kind: "tool_use",
      depends_on: ["15fc0526-ba92-4362-8b39-905334a55cd0"],
      reference_image_key: null,
    },
  ],
  objects: [
    { id: "aa879458-f450-44b0-91dd-57cdc7b4efee", label: "fan", display_name: "Case fan", prompt: "fan", color: "#1f77b4" },
    { id: "4a5ec77a-1d65-4dce-a79c-a4c972f21087", label: "bracket", display_name: "Bracket", prompt: "bracket", color: "#ff7f0e" },
    { id: "6c411ae5-a91c-4777-8d99-bf017736e8d0", label: "screwdriver", display_name: "Screwdriver", prompt: "screwdriver", color: "#2ca02c" },
  ],
  hazard_rules: [],
};

interface Clip {
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration_ms: number;
}

function probe(path: string): Clip {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=width,height,r_frame_rate,nb_read_frames:format=duration",
    "-of", "json", path,
  ]).toString();
  const info = JSON.parse(out) as {
    streams: { width: number; height: number; r_frame_rate: string; nb_read_frames: string }[];
    format: { duration: string };
  };
  const stream = info.streams[0];
  if (stream === undefined) throw new Error(`${path} has no video stream`);
  const [num, den] = stream.r_frame_rate.split("/").map(Number);
  return {
    width: stream.width,
    height: stream.height,
    fps: (num ?? 0) / (den ?? 1),
    frames: Number(stream.nb_read_frames),
    duration_ms: Math.round(Number(info.format.duration) * 1000),
  };
}

function cost(units: number, rate: { micro_usd: number; per: number }): number {
  return Math.ceil((units * rate.micro_usd) / rate.per);
}

function numberAt(record: Record<string, unknown> | null, ...path: string[]): number | null {
  let value: unknown = record;
  for (const key of path) value = (value as Record<string, unknown> | null)?.[key];
  return typeof value === "number" ? value : null;
}

function samCost(call: SamCall, clip: Clip) {
  const reported = numberAt(call.usage, "video_frames_processed");
  const frames = reported ?? clip.frames;
  const sam = PRICES["sam-3.1"];
  return { frames, reported: reported !== null, cost: cost(Math.max(frames, sam.min_frames_per_request), sam.frames) };
}

function sparkCost(call: SparkCall) {
  const tokensIn = numberAt(call.usage, "input_tokens") ?? 0;
  const cached = numberAt(call.usage, "input_tokens_details", "cached_tokens") ?? 0;
  const tokensOut = numberAt(call.usage, "output_tokens") ?? 0;
  const reasoning = numberAt(call.usage, "output_tokens_details", "reasoning_tokens");
  const spark = PRICES["muse-spark-1.3"];
  return {
    tokensIn,
    cached,
    tokensOut,
    reasoning,
    cost: cost(tokensIn - cached, spark.tokens_in) + cost(cached, spark.tokens_cached) + cost(tokensOut, spark.tokens_out),
  };
}

// What goes into a saved summary: Meta's error bodies stay on the console, out of the repo.
function errorLabel(error: unknown): string {
  if (error instanceof MetaApiError) return `MetaApiError ${String(error.status)}`;
  return error instanceof Error ? error.name : "unknown error";
}

function save(path: string, data: string): void {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data.endsWith("\n") ? data : `${data}\n`);
  console.log(`saved ${path}`);
}

const usd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(6)}`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      clip: { type: "string", default: "fixtures/clips/first-clip.mp4" },
      run: { type: "string" },
      effort: { type: "string" },
      "file-id": { type: "string" },
      "max-requests": { type: "string" },
    },
  });
  const apiKey = process.env.META_API_KEY;
  if (apiKey === undefined || apiKey === "") throw new Error("META_API_KEY is not set");
  const run = values.run;
  const effort = values.effort as ReasoningEffort | undefined;
  const maxRequests = Number(values["max-requests"]);
  if (run === undefined || effort === undefined || !Number.isInteger(maxRequests)) {
    throw new Error("--run, --effort and --max-requests are required");
  }
  const client = { apiKey, requestsLeft: maxRequests };
  const clipPath = join(ROOT, values.clip);
  const clip = probe(clipPath);
  const prefix = `${basename(values.clip, ".mp4")}-${run}`;
  console.log(`clip ${values.clip}: ${String(clip.width)}x${String(clip.height)}, ${String(clip.fps)} fps, ${String(clip.frames)} frames, ${String(clip.duration_ms)} ms`);

  let fileId = values["file-id"];
  let uploadMs: number | null = null;
  if (fileId === undefined) {
    const upload = await uploadFile(client, new Blob([readFileSync(clipPath)], { type: "video/mp4" }), basename(clipPath));
    save(`fixtures/raw/${basename(values.clip, ".mp4")}-upload.json`, JSON.stringify(upload.raw, null, 2));
    fileId = upload.file.id;
    uploadMs = upload.latency_ms;
  }

  const started = Date.now();
  const [samResult, sparkResult] = await Promise.allSettled([
    trackSegment(client, {
      session_id: crypto.randomUUID(),
      segment_n: 0,
      file_id: fileId,
      fps: clip.fps,
      frame_count: clip.frames,
      frame_w: clip.width,
      frame_h: clip.height,
      objects: PROCEDURE.objects.map(({ label, prompt }) => ({ label, prompt })),
      timeout_ms: SAM_TIMEOUT_MS,
    }),
    observeSegment(client, {
      file_id: fileId,
      segment_ms: clip.duration_ms,
      procedure: PROCEDURE,
      state: "no step is completed yet",
      previous_tracks: null,
      recent_summaries: [],
      prompt_cache_key: null,
      effort,
      timeout_ms: SPARK_TIMEOUT_MS,
    }),
  ]);
  const wallMs = Date.now() - started;

  if (samResult.status === "fulfilled") {
    for (const call of samResult.value.calls) save(`fixtures/raw/${prefix}-sam-${call.label}.sse`, call.raw);
    save(`fixtures/Tracks/${prefix}.json`, JSON.stringify(samResult.value.tracks, null, 2));
  }
  if (sparkResult.status === "fulfilled") {
    save(`fixtures/raw/${prefix}-spark.json`, JSON.stringify(sparkResult.value.raw, null, 2));
    save(`fixtures/Observation/${prefix}.json`, JSON.stringify(sparkResult.value.observation, null, 2));
  } else if (sparkResult.reason instanceof SparkReplyError) {
    save(`fixtures/raw/${prefix}-spark-rejected.json`, JSON.stringify(sparkResult.reason.raw, null, 2));
  }

  const summary: Record<string, unknown> = {
    run,
    file_id: fileId,
    clip,
    spark_effort: effort,
    upload_ms: uploadMs,
    sam_and_spark_wall_ms: wallMs,
    requests_sent: maxRequests - client.requestsLeft,
  };
  console.log(`\nfile_id ${fileId}; upload ${uploadMs === null ? "reused" : `${String(uploadMs)} ms`}; SAM and Spark wall ${String(wallMs)} ms`);
  if (samResult.status === "fulfilled") {
    const { tracks, calls } = samResult.value;
    console.log(`SAM total (first sent to last done): ${String(tracks.latency_ms)} ms`);
    summary.sam = calls.map((call) => {
      const object = tracks.objects.find((tracked) => tracked.label === call.label);
      const billed = samCost(call, clip);
      const framesWithBox = new Set(call.matches.map((match) => match.frame)).size;
      const maxInstances = Math.max(0, ...call.matches.map((match) => match.instance + 1));
      console.log(
        `  sam ${call.label}: ${String(call.latency_ms)} ms, frames ${String(billed.frames)}${billed.reported ? "" : " (from the clip; usage has none)"}, ` +
          `${usd(billed.cost)}, matches ${String(call.matches.length)} in ${String(framesWithBox)}/${String(clip.frames)} frames, ` +
          `max ${String(maxInstances)} per frame, confidence ${String(object?.confidence ?? null)}`,
      );
      return {
        label: call.label,
        response_id: call.response_id,
        latency_ms: call.latency_ms,
        usage: call.usage,
        frames_billed: billed.frames,
        cost_micro_usd: billed.cost,
        matches: call.matches.length,
        frames_with_box: framesWithBox,
        max_instances_per_frame: maxInstances,
      };
    });
  } else {
    console.log(`SAM failed: ${String(samResult.reason)}`);
    summary.sam_error = errorLabel(samResult.reason);
  }
  if (sparkResult.status === "fulfilled") {
    const call = sparkResult.value;
    const billed = sparkCost(call);
    console.log(
      `  spark ${effort}: ${String(call.latency_ms)} ms, tokens in ${String(billed.tokensIn)} (cached ${String(billed.cached)}), ` +
        `out ${String(billed.tokensOut)} (reasoning ${String(billed.reasoning)}), ${usd(billed.cost)}`,
    );
    console.log(`  observation: ${JSON.stringify(call.observation)}`);
    summary.spark = { response_id: call.response_id, latency_ms: call.latency_ms, usage: call.usage, cost_micro_usd: billed.cost };
  } else {
    console.log(`Spark failed: ${String(sparkResult.reason)}`);
    summary.spark_error = errorLabel(sparkResult.reason);
  }
  console.log(`Meta requests sent this run: ${String(summary.requests_sent)}`);
  save(`fixtures/raw/${prefix}-summary.json`, JSON.stringify(summary, null, 2));
}

await main();
