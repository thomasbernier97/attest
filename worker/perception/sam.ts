// Object tracking with sam-3.1 on an uploaded segment: one request per object label (SAM takes one
// text concept per request), all sent in parallel, each parsed into a Tracks object.
import { Tracks, TRACKS_VERSION, type TrackFrame, type TrackedObject } from "@attest/shared";
import { metaFetch, type MetaClient } from "../meta/api";

export const SAM_MODEL = "sam-3.1";

export interface SamMatch {
  // Frame index in the segment, from SAM's <Nf> marker.
  frame: number;
  // SAM's ordinal for the match within the frame.
  instance: number;
  // [x1, y1, x2, y2] in pixels of the w by h source frame.
  box: [number, number, number, number];
  w: number;
  h: number;
  // The box's confidence, the c field SAM adds when include_confidence is set.
  score: number | null;
}

export interface SamCall {
  label: string;
  prompt: string;
  model_call_id: string;
  // Meta's response id, from the stream's response events.
  response_id: string | null;
  started_at: number;
  latency_ms: number;
  usage: Record<string, unknown> | null;
  matches: SamMatch[];
  // The server-sent event stream as received.
  raw: string;
}

export interface SegmentInput {
  session_id: string;
  segment_n: number;
  file_id: string;
  fps: number;
  frame_count: number;
  frame_w: number;
  frame_h: number;
  objects: readonly { label: string; prompt: string }[];
  timeout_ms: number;
}

const FRAME_MARKER = /<(\d+)f>/g;
const BOX_TOKEN = /(\d+)<\|box;([^|]*)\|>/g;

function boxFields(body: string): Record<string, number> {
  const fields: Record<string, number> = {};
  for (const pair of body.split(";")) {
    const [key, value] = pair.split("=");
    if (key !== undefined && value !== undefined) fields[key] = Number(value);
  }
  return fields;
}

// Parses SAM's special-token text: <Nf> starts frame N, followed by comma-separated matches, each
// "<ordinal><|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..;c=..|><|mask;...|>". Masks are skipped for now.
export function parseSamText(text: string): SamMatch[] {
  const markers = [...text.matchAll(FRAME_MARKER)];
  const matches: SamMatch[] = [];
  markers.forEach((marker, index) => {
    const end = markers[index + 1]?.index ?? text.length;
    const chunk = text.slice(marker.index + marker[0].length, end);
    for (const token of chunk.matchAll(BOX_TOKEN)) {
      const fields = boxFields(token[2] ?? "");
      const { x1, y1, x2, y2, w, h } = fields;
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined || w === undefined || h === undefined) {
        throw new Error(`SAM box token is missing a field: ${token[0]}`);
      }
      matches.push({
        frame: Number(marker[1]),
        instance: Number(token[1]),
        box: [x1, y1, x2, y2],
        w,
        h,
        score: fields.c ?? null,
      });
    }
  });
  return matches;
}

interface StreamEvent {
  type?: string;
  delta?: string;
  response?: { id?: string; status?: string; usage?: Record<string, unknown> };
  error?: unknown;
}

// Reads a Responses API event stream: text deltas, the response id and the final usage. A stream
// that does not end in a completed response is an error, never a short list of matches.
function readStream(raw: string) {
  let completed = false;
  let text = "";
  let responseId: string | null = null;
  let usage: Record<string, unknown> | null = null;
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice("data: ".length).trim();
    if (data === "[DONE]") break;
    const event = JSON.parse(data) as StreamEvent;
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
    if (event.response?.id !== undefined) responseId = event.response.id;
    if (event.response?.usage !== undefined) usage = event.response.usage;
    if (event.type === "response.completed" && event.response?.status === "completed") completed = true;
    if (event.type === "error" || event.type === "response.failed" || event.type === "response.incomplete") {
      throw new Error(`SAM stream ended with ${event.type}`);
    }
  }
  if (!completed) throw new Error("SAM stream ended without a completed response");
  return { text, responseId, usage };
}

export async function trackObject(
  client: MetaClient,
  fileId: string,
  label: string,
  prompt: string,
  timeoutMs: number,
): Promise<SamCall> {
  const body = {
    model: SAM_MODEL,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_video", file_id: fileId },
        ],
      },
    ],
    stream: true,
    // Metadata values are strings.
    metadata: { mask_encoding: "one_bit", include_confidence: "true" },
  };
  const started_at = Date.now();
  const response = await metaFetch(client, "/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await response.text();
  const latency_ms = Date.now() - started_at;
  const { text, responseId, usage } = readStream(raw);
  return {
    label,
    prompt,
    model_call_id: crypto.randomUUID(),
    response_id: responseId,
    started_at,
    latency_ms,
    usage,
    matches: parseSamText(text),
    raw,
  };
}

function toTrackedObject(call: SamCall, input: SegmentInput): TrackedObject {
  const frames: TrackFrame[] = call.matches.map((match) => {
    // Boxes are stored in the segment's pixels; SAM reports them in the w by h it decoded.
    const sx = input.frame_w / match.w;
    const sy = input.frame_h / match.h;
    const [x1, y1, x2, y2] = match.box;
    return {
      t_ms: Math.round((match.frame * 1000) / input.fps),
      box: [Math.round(x1 * sx), Math.round(y1 * sy), Math.round(x2 * sx), Math.round(y2 * sy)],
      mask_key: null,
    };
  });
  const scores = call.matches.flatMap((match) => (match.score === null ? [] : [match.score]));
  const framesWithBox = new Set(call.matches.map((match) => match.frame)).size;
  // SAM's own frame count is the denominator; the capture's count is the fallback.
  const processed = call.usage?.video_frames_processed;
  const frameCount = typeof processed === "number" && processed > 0 ? processed : input.frame_count;
  return {
    label: call.label,
    prompt: call.prompt,
    model_call_id: call.model_call_id,
    confidence: scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length,
    present_ratio: Math.min(1, framesWithBox / frameCount),
    frames,
  };
}

export async function trackSegment(client: MetaClient, input: SegmentInput): Promise<{ tracks: Tracks; calls: SamCall[] }> {
  const started = Date.now();
  const calls = await Promise.all(input.objects.map((object) => trackObject(client, input.file_id, object.label, object.prompt, input.timeout_ms)));
  const latency_ms = Date.now() - started;
  const tracks = Tracks.parse({
    v: TRACKS_VERSION,
    session_id: input.session_id,
    segment_n: input.segment_n,
    file_id: input.file_id,
    fps: input.fps,
    frame_w: input.frame_w,
    frame_h: input.frame_h,
    objects: calls.map((call) => toTrackedObject(call, input)),
    latency_ms,
  });
  return { tracks, calls };
}
