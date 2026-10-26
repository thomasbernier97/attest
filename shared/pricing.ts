// Meta model prices, read from dev.meta.ai on the as-of date. Costs are micro-USD ($1 = 1,000,000):
// a rate charges `micro_usd` for every `per` units. Unit names match ModelCall's token fields and
// media_unit_kind.
import type { ModelId } from "./contracts/common";

export const PRICING_VERSION = 1;
export const PRICES_AS_OF = "2026-10-23";

export interface Rate {
  micro_usd: number;
  per: number;
}

export const PRICES = {
  "sam-3.1": {
    frames: { micro_usd: 200_000, per: 1_000 },
    images: { micro_usd: 2_500_000, per: 1_000 },
    // Each video request is billed for at least this many frames.
    min_frames_per_request: 50,
  },
  "muse-spark-1.3": {
    tokens_in: { micro_usd: 1_250_000, per: 1_000_000 },
    tokens_cached: { micro_usd: 150_000, per: 1_000_000 },
    tokens_out: { micro_usd: 4_250_000, per: 1_000_000 },
  },
  "muse-voice-transcribe-1.0": {
    // $0.18 per audio hour.
    audio_seconds: { micro_usd: 180_000, per: 3_600 },
  },
  "muse-image-1.0": {
    images: { micro_usd: 10_000, per: 1 },
  },
} as const satisfies Record<ModelId, Record<string, Rate | number>>;
