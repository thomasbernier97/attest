// Replays recorded segments through the session server loop on a local wrangler dev: compiles the
// procedure text (or gets the procedure already stored from it), approves it, creates a replay
// session for it, opens the session socket, uploads either one clip as segment 0 or a directory of
// segments at the offsets they were first received at, prints every server message, then checks
// the messages against the local D1 rows and prints, per segment, the queue wait, processing time,
// objects tracked, Spark's cached tokens and the events, and the Meta request count and cost.
// Usage: pnpm tsx scripts/replay-clip.ts [--base http://127.0.0.1:8787]
//          [--clip fixtures/clips/first-clip.mp4 | --segments <dir>] [--source docs/demo-procedure.md]
//          [--wait-ms 60000] [--persist-to <wrangler state dir>]
// A segments directory holds <n>.mp4 for n = 0, 1, ... and segments.json, an array of
// { n, started_ms, duration_ms, offset_ms } with offset_ms the time after segment 0 to upload it.
// --wait-ms is how long to wait for the last segment after it is uploaded.
// A text the server has not compiled before costs one more Meta request, of about 40 s.
// wrangler dev must be running in worker/ with META_API_KEY and SESSION_SIGNING_KEY in .dev.vars,
// with the same --persist-to when one is given.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ServerMessage, TimelineEvent } from "../shared/contracts/index.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:8787" },
    clip: { type: "string", default: "fixtures/clips/first-clip.mp4" },
    segments: { type: "string" },
    source: { type: "string", default: "docs/demo-procedure.md" },
    "wait-ms": { type: "string", default: "60000" },
    "persist-to": { type: "string" },
  },
});

interface SegmentFile {
  n: number;
  path: string;
  started_ms: number;
  duration_ms: number;
  offset_ms: number;
}

function d1<T>(sql: string): T[] {
  const persist = values["persist-to"] === undefined ? [] : ["--persist-to", resolve(ROOT, values["persist-to"])];
  const out = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "attest", "--local", ...persist, "--json", "--command", sql], {
    cwd: join(ROOT, "worker"),
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
  const parsed = JSON.parse(out) as { results: T[] }[];
  return parsed[0]?.results ?? [];
}

function probeDurationMs(path: string): number {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).toString();
  return Math.round(Number(out.trim()) * 1000);
}

function segmentFiles(): SegmentFile[] {
  if (values.segments === undefined) {
    const path = resolve(ROOT, values.clip);
    return [{ n: 0, path, started_ms: 0, duration_ms: probeDurationMs(path), offset_ms: 0 }];
  }
  const dir = resolve(ROOT, values.segments);
  const manifest = JSON.parse(readFileSync(join(dir, "segments.json"), "utf8")) as Omit<SegmentFile, "path">[];
  return manifest
    .sort((a, b) => a.n - b.n)
    .map(({ n, started_ms, duration_ms, offset_ms }) => ({ n, path: join(dir, `${String(n)}.mp4`), started_ms, duration_ms, offset_ms }));
}

const usd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(6)}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const segments = segmentFiles();
  const lastN = segments.at(-1)?.n ?? 0;
  const sourceText = readFileSync(join(ROOT, values.source), "utf8");
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${values.base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(`POST ${path} returned ${String(response.status)}: ${JSON.stringify(json)}`);
    console.log(`POST ${path} -> ${String(response.status)}`);
    return json;
  };
  const compiled = (await post("/api/procedures", { v: 1, source_text: sourceText })) as { procedure: { id: string; steps: { id: string; ordinal: number }[] } };
  const procedureId = compiled.procedure.id;
  const ordinalOf = new Map(compiled.procedure.steps.map((step) => [step.id, step.ordinal]));
  await post(`/api/procedures/${procedureId}/approve`, {});
  const created = await fetch(`${values.base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, kind: "replay", procedure_id: procedureId, user_agent: "scripts/replay-clip.ts" }),
  });
  const createdBody = (await created.json()) as { session: { id: string }; token: string };
  if (!created.ok) throw new Error(`POST /api/sessions returned ${String(created.status)}: ${JSON.stringify(createdBody)}`);
  const sessionId = createdBody.session.id;
  console.log(`replay session ${sessionId} created (${String(created.status)}) for procedure ${procedureId}`);

  const messages: ServerMessage[] = [];
  const wsUrl = `${values.base.replace(/^http/, "ws")}/api/sessions/${sessionId}/ws?token=${encodeURIComponent(createdBody.token)}`;
  const ws = new WebSocket(wsUrl);
  let finished: () => void = () => undefined;
  const lastDone = new Promise<void>((resolve) => (finished = resolve));
  ws.addEventListener("message", (event) => {
    const message = ServerMessage.parse(JSON.parse(String(event.data)));
    messages.push(message);
    console.log(`<- ${message.type === "tracks" ? `tracks n ${String(message.n)}: ${message.objects.map((object) => `${object.label} ${String(object.boxes.length)} boxes`).join(", ")}` : JSON.stringify(message)}`);
    if (message.type === "segment_ack" && message.n === lastN && (message.state === "done" || message.state === "gap")) {
      finished();
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => {
      resolve();
    });
    ws.addEventListener("error", () => {
      reject(new Error("the socket failed to open"));
    });
  });

  const start = Date.now();
  for (const segment of segments) {
    await sleep(Math.max(0, start + segment.offset_ms - Date.now()));
    const bytes = readFileSync(segment.path);
    const put = await fetch(`${values.base}/api/sessions/${sessionId}/segments/${String(segment.n)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${createdBody.token}`,
        "Content-Type": "video/mp4",
        "X-Segment-Started-Ms": String(segment.started_ms),
        "X-Segment-Duration-Ms": String(segment.duration_ms),
        "X-Segment-Sha256": createHash("sha256").update(bytes).digest("hex"),
      },
      body: bytes,
    });
    console.log(`PUT segment ${String(segment.n)} -> ${String(put.status)} ${await put.text()}`);
    if (!put.ok) throw new Error(`the upload of segment ${String(segment.n)} failed`);
  }

  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => {
    resolve("timeout");
  }, Number(values["wait-ms"])));
  if ((await Promise.race([lastDone, timeout])) === "timeout") throw new Error(`segment ${String(lastN)} was not processed in time`);
  // Let the spend message after the final ack arrive.
  await sleep(500);
  ws.close();

  // Check the messages against the D1 rows.
  const checks: [string, boolean][] = [];
  checks.push(["session_state is the first message", messages[0]?.type === "session_state"]);
  const acks = (n: number) => messages.flatMap((message) => (message.type === "segment_ack" && message.n === n ? [message] : []));
  const ackOrder = segments.every((segment) => {
    const states = acks(segment.n).map((ack) => ack.state);
    return states[0] === "queued" && states[1] === "processing" && (states[2] === "done" || states[2] === "gap");
  });
  checks.push(["every segment_ack runs queued, processing, then done or gap", ackOrder]);
  const tracksMessages = messages.flatMap((message) => (message.type === "tracks" ? [message] : []));
  const tracksRows = d1<{ segment_n: number; body: string }>(`SELECT segment_n, body FROM tracks WHERE session_id = '${sessionId}' ORDER BY segment_n`);
  checks.push([`one tracks row per tracks message (${String(tracksMessages.length)} sent, ${String(tracksRows.length)} stored)`, tracksMessages.length === tracksRows.length]);
  const tracksMatch = tracksRows.every((row) => {
    const sent = tracksMessages.find((message) => message.n === row.segment_n);
    const body = JSON.parse(row.body) as { objects: { label: string; confidence: number | null }[] };
    return body.objects.length === sent?.objects.length && body.objects.every((object) => sent.objects.some((candidate) => candidate.label === object.label && candidate.confidence === object.confidence));
  });
  checks.push(["tracks message labels and confidences match the rows", tracksMatch]);
  const sentEvents = messages.flatMap((message): TimelineEvent[] => {
    if (message.type === "step_event") return [message.step_event];
    if (message.type === "hazard_event") return [message.hazard_event];
    if (message.type === "gap") return [message.gap];
    return [];
  });
  const eventRows = d1<{ body: string }>(`SELECT body FROM events WHERE session_id = '${sessionId}' ORDER BY seq`).map((row) =>
    TimelineEvent.parse(JSON.parse(row.body)),
  );
  checks.push([`events sent match the event rows in order (${String(sentEvents.length)} sent, ${String(eventRows.length)} stored)`, JSON.stringify(sentEvents) === JSON.stringify(eventRows)]);
  checks.push(["at least one derived event", eventRows.length > 0]);
  const calls = d1<{ segment_n: number | null; purpose: string; model: string; concept_label: string | null; outcome: string; latency_ms: number; cost_micro_usd: number; request_id: string | null; body: string }>(
    `SELECT segment_n, purpose, model, concept_label, outcome, latency_ms, cost_micro_usd, request_id, body FROM model_calls WHERE session_id = '${sessionId}' ORDER BY segment_n, purpose`,
  );
  const segmentRows = d1<{ n: number; state: string }>(`SELECT n, state FROM segments WHERE session_id = '${sessionId}' ORDER BY n`);
  checks.push([
    `segment row states match the last acks (${String(segmentRows.length)} rows)`,
    segmentRows.length === segments.length && segmentRows.every((row) => row.state === acks(row.n).at(-1)?.state),
  ]);

  console.log(`\nper segment (replay session ${sessionId}, recorded segments):`);
  for (const segment of segments) {
    const at = (state: string) => acks(segment.n).find((ack) => ack.state === state)?.server_at;
    const queued = at("queued");
    const processing = at("processing");
    const end = at("done") ?? at("gap");
    const objects = tracksMessages.find((message) => message.n === segment.n)?.objects.map((object) => `${object.label}:${String(object.boxes.length)}`) ?? [];
    const spark = calls.find((call) => call.segment_n === segment.n && call.purpose === "observe");
    const usage = spark === undefined ? null : (JSON.parse(spark.body) as { tokens_in: number; tokens_cached: number });
    const events = eventRows
      .filter((event) => event.segment_n === segment.n)
      .map((event) => `${event.type}${"step_id" in event ? ` step ${String(ordinalOf.get(event.step_id))}` : ""} ${String(event.confidence)} ${event.id}`);
    const span = (from: number | undefined, to: number | undefined) => (from === undefined || to === undefined ? "?" : String(to - from));
    console.log(
      `  ${String(segment.n)}: queue ${span(queued, processing)} ms, processing ${span(processing, end)} ms, ${acks(segment.n).at(-1)?.state ?? "?"}; ` +
        `objects ${objects.join(" ") || "none"}; spark cached ${String(usage?.tokens_cached)}/${String(usage?.tokens_in)}; events ${events.join("; ") || "none"}`,
    );
  }
  console.log("\nmodel calls:");
  for (const call of calls) {
    console.log(`  ${String(call.segment_n)} ${call.purpose} ${call.model} ${call.concept_label ?? "-"}: ${call.outcome}, ${String(call.latency_ms)} ms, ${usd(call.cost_micro_usd)}, ${String(call.request_id)}`);
  }
  const cost = calls.reduce((sum, call) => sum + call.cost_micro_usd, 0);
  // Each Files API upload is one more Meta request and is not a model call.
  console.log(`Meta requests: ${String(calls.length + segmentRows.length)} (${String(calls.length)} model calls + ${String(segmentRows.length)} file uploads); cost ${usd(cost)}`);
  console.log("\nchecks:");
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

await main();
