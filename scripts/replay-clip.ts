// Replays one recorded clip through the session server loop on a local wrangler dev: creates a
// replay session from an approved ProcedureDraft, opens the session socket, uploads the clip as
// segment 0, prints every server message, then checks the messages against the local D1 rows and
// prints the Meta request count and cost from the ModelCall rows.
// Usage: pnpm tsx scripts/replay-clip.ts [--base http://127.0.0.1:8787]
//          [--clip fixtures/clips/first-clip.mp4] [--draft fixtures/ProcedureDraft/demo.json]
//          [--source docs/demo-procedure.md] [--wait-ms 60000]
// wrangler dev must be running in worker/ with META_API_KEY and SESSION_SIGNING_KEY in .dev.vars.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { ServerMessage, TimelineEvent } from "../shared/contracts/index.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:8787" },
    clip: { type: "string", default: "fixtures/clips/first-clip.mp4" },
    draft: { type: "string", default: "fixtures/ProcedureDraft/demo.json" },
    source: { type: "string", default: "docs/demo-procedure.md" },
    "wait-ms": { type: "string", default: "60000" },
  },
});

function d1<T>(sql: string): T[] {
  const out = execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", "attest", "--local", "--json", "--command", sql], {
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

const usd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(6)}`;

async function main(): Promise<void> {
  const draft: unknown = JSON.parse(readFileSync(join(ROOT, values.draft), "utf8"));
  const sourceText = readFileSync(join(ROOT, values.source), "utf8");
  const created = await fetch(`${values.base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, kind: "replay", draft, source_text: sourceText, user_agent: "scripts/replay-clip.ts" }),
  });
  const createdBody = (await created.json()) as { session: { id: string }; token: string };
  if (!created.ok) throw new Error(`POST /api/sessions returned ${String(created.status)}: ${JSON.stringify(createdBody)}`);
  const sessionId = createdBody.session.id;
  console.log(`session ${sessionId} created (${String(created.status)})`);

  const messages: ServerMessage[] = [];
  const wsUrl = `${values.base.replace(/^http/, "ws")}/api/sessions/${sessionId}/ws?token=${encodeURIComponent(createdBody.token)}`;
  const ws = new WebSocket(wsUrl);
  let finished: () => void = () => undefined;
  const segmentDone = new Promise<void>((resolve) => (finished = resolve));
  ws.addEventListener("message", (event) => {
    const message = ServerMessage.parse(JSON.parse(String(event.data)));
    messages.push(message);
    console.log(`<- ${JSON.stringify(message)}`);
    if (message.type === "segment_ack" && message.n === 0 && (message.state === "done" || message.state === "gap")) {
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

  const clipPath = join(ROOT, values.clip);
  const bytes = readFileSync(clipPath);
  const put = await fetch(`${values.base}/api/sessions/${sessionId}/segments/0`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${createdBody.token}`,
      "Content-Type": "video/mp4",
      "X-Segment-Started-Ms": "0",
      "X-Segment-Duration-Ms": String(probeDurationMs(clipPath)),
      "X-Segment-Sha256": createHash("sha256").update(bytes).digest("hex"),
    },
    body: bytes,
  });
  console.log(`PUT segment 0 -> ${String(put.status)} ${await put.text()}`);
  if (!put.ok) throw new Error("the segment upload failed");

  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => {
    resolve("timeout");
  }, Number(values["wait-ms"])));
  if ((await Promise.race([segmentDone, timeout])) === "timeout") throw new Error("segment 0 was not processed in time");
  // Let the spend message after the final ack arrive.
  await new Promise((resolve) => setTimeout(resolve, 500));
  ws.close();

  // Check the messages against the D1 rows.
  const checks: [string, boolean][] = [];
  checks.push(["session_state is the first message", messages[0]?.type === "session_state"]);
  const acks = messages.flatMap((message) => (message.type === "segment_ack" ? [message.state] : []));
  checks.push([`segment_ack queued, processing, then done or gap (${acks.join(", ")})`, acks[0] === "queued" && acks[1] === "processing" && (acks[2] === "done" || acks[2] === "gap")]);
  const tracksMessage = messages.find((message) => message.type === "tracks");
  const tracksRows = d1<{ body: string }>(`SELECT body FROM tracks WHERE session_id = '${sessionId}'`);
  checks.push(["one tracks message and one tracks row", tracksMessage !== undefined && tracksRows.length === 1]);
  if (tracksMessage?.type === "tracks" && tracksRows[0] !== undefined) {
    const row = JSON.parse(tracksRows[0].body) as { objects: { label: string; confidence: number | null }[] };
    const same = row.objects.every((object) => tracksMessage.objects.some((sent) => sent.label === object.label && sent.confidence === object.confidence));
    checks.push(["tracks message labels and confidences match the row", same && row.objects.length === tracksMessage.objects.length]);
  }
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
  const calls = d1<{ purpose: string; model: string; concept_label: string | null; outcome: string; latency_ms: number; cost_micro_usd: number; request_id: string | null }>(
    `SELECT purpose, model, concept_label, outcome, latency_ms, cost_micro_usd, request_id FROM model_calls WHERE session_id = '${sessionId}'`,
  );
  const segmentRows = d1<{ file_id: string; state: string }>(`SELECT file_id, state FROM segments WHERE session_id = '${sessionId}'`);
  checks.push([`segment row state ${String(segmentRows[0]?.state)} matches the last ack`, segmentRows[0]?.state === acks.at(-1)]);

  console.log("\nmodel calls:");
  for (const call of calls) {
    console.log(`  ${call.purpose} ${call.model} ${call.concept_label ?? "-"}: ${call.outcome}, ${String(call.latency_ms)} ms, ${usd(call.cost_micro_usd)}, ${String(call.request_id)}`);
  }
  const cost = calls.reduce((sum, call) => sum + call.cost_micro_usd, 0);
  // The Files API upload is one more Meta request and is not a model call.
  console.log(`Meta requests: ${String(calls.length + segmentRows.length)} (${String(calls.length)} model calls + ${String(segmentRows.length)} file upload); cost ${usd(cost)}`);
  console.log("\nchecks:");
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

await main();
