// Compiles one procedure text into a ProcedureDraft with muse-spark-1.3 (one request), prints the
// steps, objects with their SAM prompts, hazard rules, tokens, latency and cost, and saves the raw
// response under fixtures/raw/ and the draft under fixtures/ProcedureDraft/.
// Usage: META_API_KEY=... pnpm tsx scripts/compile-procedure.ts --name demo --max-requests <n>
//          [--source docs/demo-procedure.md]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { PRICES } from "../shared/pricing.ts";
import { MetaApiError } from "../worker/meta/api.ts";
import { SparkReplyError } from "../worker/perception/spark.ts";
import { compileProcedure } from "../worker/procedure/compile.ts";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..");
const COMPILE_TIMEOUT_MS = 300_000;

function cost(units: number, rate: { micro_usd: number; per: number }): number {
  return Math.ceil((units * rate.micro_usd) / rate.per);
}

function numberAt(record: Record<string, unknown> | null, ...path: string[]): number | null {
  let value: unknown = record;
  for (const key of path) value = (value as Record<string, unknown> | null)?.[key];
  return typeof value === "number" ? value : null;
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
      source: { type: "string", default: "docs/demo-procedure.md" },
      name: { type: "string" },
      "max-requests": { type: "string" },
    },
  });
  const apiKey = process.env.META_API_KEY;
  if (apiKey === undefined || apiKey === "") throw new Error("META_API_KEY is not set");
  const name = values.name;
  const maxRequests = Number(values["max-requests"]);
  if (name === undefined || !Number.isInteger(maxRequests)) throw new Error("--name and --max-requests are required");
  const client = { apiKey, requestsLeft: maxRequests };
  const text = readFileSync(join(ROOT, values.source), "utf8");

  let call;
  try {
    call = await compileProcedure(client, { text, timeout_ms: COMPILE_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof SparkReplyError) save(`fixtures/raw/${name}-procedure-spark-rejected.json`, JSON.stringify(error.raw, null, 2));
    // Meta's error bodies stay on the console, out of the repo.
    if (error instanceof MetaApiError) console.log(`MetaApiError ${String(error.status)}`);
    throw error;
  }
  save(`fixtures/raw/${name}-procedure-spark.json`, JSON.stringify(call.raw, null, 2));
  save(`fixtures/ProcedureDraft/${name}.json`, JSON.stringify(call.draft, null, 2));

  const { draft } = call;
  console.log(`\n${draft.title} (${draft.language})\n\nBefore step 1: ${draft.starting_state ?? "none"}\n\nSteps:`);
  for (const step of draft.steps) {
    console.log(
      `  ${String(step.ordinal)}. ${step.instruction}\n     cue (${step.cue_kind}): ${step.completion_cue}\n` +
        `     objects: ${step.expected_objects.join(", ") || "none"}; depends on: ${step.depends_on.join(", ") || "none"}`,
    );
  }
  console.log("Objects:");
  for (const object of draft.objects) console.log(`  ${object.label} (${object.display_name}): "${object.prompt}"`);
  console.log("Hazard rules:");
  for (const rule of draft.hazard_rules) {
    console.log(
      `  before step ${String(rule.before_step)}, ${rule.severity}, ${rule.condition_kind} on ${rule.object_label}: ${rule.condition}\n` +
        `     says: ${rule.message}`,
    );
  }

  const tokensIn = numberAt(call.usage, "input_tokens") ?? 0;
  const cached = numberAt(call.usage, "input_tokens_details", "cached_tokens") ?? 0;
  const tokensOut = numberAt(call.usage, "output_tokens") ?? 0;
  const reasoning = numberAt(call.usage, "output_tokens_details", "reasoning_tokens");
  const spark = PRICES["muse-spark-1.3"];
  const costMicroUsd = cost(tokensIn - cached, spark.tokens_in) + cost(cached, spark.tokens_cached) + cost(tokensOut, spark.tokens_out);
  console.log(
    `\nspark high: ${String(call.latency_ms)} ms, tokens in ${String(tokensIn)} (cached ${String(cached)}), ` +
      `out ${String(tokensOut)} (reasoning ${String(reasoning)}), ${usd(costMicroUsd)}`,
  );
  const requestsSent = maxRequests - client.requestsLeft;
  console.log(`Meta requests sent this run: ${String(requestsSent)}`);
  save(
    `fixtures/raw/${name}-procedure-summary.json`,
    JSON.stringify(
      {
        name,
        source: values.source,
        response_id: call.response_id,
        latency_ms: call.latency_ms,
        usage: call.usage,
        cost_micro_usd: costMicroUsd,
        requests_sent: requestsSent,
      },
      null,
      2,
    ),
  );
}

await main();
