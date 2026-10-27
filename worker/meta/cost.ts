// Cost of a model call in micro-USD, recomputed from the call's own usage with shared/pricing.ts.
import type { ModelCall } from "@attest/shared";
import { PRICES, type Rate } from "@attest/shared/pricing";

function charge(units: number, rate: Rate): number {
  return Math.ceil((units * rate.micro_usd) / rate.per);
}

export type Usage = Pick<ModelCall, "model" | "tokens_in" | "tokens_cached" | "tokens_out" | "media_units" | "media_unit_kind">;

export function callCost(usage: Usage): number {
  switch (usage.model) {
    case "sam-3.1": {
      const sam = PRICES["sam-3.1"];
      if (usage.media_units === 0) return 0;
      if (usage.media_unit_kind === "images") return charge(usage.media_units, sam.images);
      // Each video request is billed for at least the minimum frame count.
      return charge(Math.max(usage.media_units, sam.min_frames_per_request), sam.frames);
    }
    case "muse-spark-1.3": {
      const spark = PRICES["muse-spark-1.3"];
      return (
        charge(usage.tokens_in - usage.tokens_cached, spark.tokens_in) +
        charge(usage.tokens_cached, spark.tokens_cached) +
        charge(usage.tokens_out, spark.tokens_out)
      );
    }
    case "muse-voice-transcribe-1.0":
      return charge(usage.media_units, PRICES["muse-voice-transcribe-1.0"].audio_seconds);
    case "muse-image-1.0":
      return charge(usage.media_units, PRICES["muse-image-1.0"].images);
  }
}

// A number inside a usage object, by path; null when absent.
export function usageNumber(usage: Record<string, unknown> | null, ...path: string[]): number | null {
  let value: unknown = usage;
  for (const key of path) value = (value as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" ? value : null;
}
