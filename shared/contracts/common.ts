// Field types shared by every contract. See docs/contracts.md, "Conventions every seat follows".
import { z } from "zod";

// Lowercase UUID v4, as minted by crypto.randomUUID().
export const Uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "lowercase UUID v4");

// Unix epoch milliseconds, UTC, from the server clock (fields ending in _at).
export const EpochMs = z.int().nonnegative();

// Segment index, numbered from 0 per session.
export const SegmentN = z.int().nonnegative();

export const Confidence = z.number().min(0).max(1);

export const MicroUsd = z.int().nonnegative();

export const ObjectLabel = z.string().regex(/^[a-z0-9_]{1,32}$/, "object label slug");

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "hex color");

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, "sha256 hex");

// BCP-47 language tag, e.g. "en" or "pt-BR".
export const LanguageTag = z.string().regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/, "BCP-47 language tag");

export const ModelId = z.enum(["muse-spark-1.3", "sam-3.1", "muse-voice-transcribe-1.0", "muse-image-1.0"]);
export type ModelId = z.infer<typeof ModelId>;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

// Trimmed string with a character range.
export function text(min: number, max: number) {
  return z.string().trim().min(min).max(max);
}

// Trimmed string with a word cap.
export function words(max: number, min = 0) {
  return z
    .string()
    .trim()
    .refine((value) => {
      const count = countWords(value);
      return count >= min && count <= max;
    }, `${String(min)} to ${String(max)} words`);
}
