import { z } from "zod";
import { Confidence, Uuid } from "./common";

export const UTTERANCE_VERSION = 1;

export const Intent = z.enum(["start", "next", "done", "repeat", "go_back", "yes", "no", "question", "none"]);
export type Intent = z.infer<typeof Intent>;

export const Utterance = z.object({
  v: z.literal(UTTERANCE_VERSION),
  id: Uuid,
  session_id: Uuid,
  // The ASR turnId.
  turn_id: z.int(),
  // Final transcript from speechComplete.
  text: z.string().trim(),
  // Detected language; null if the model did not say.
  language: z.string().nullable(),
  started_ms: z.int().nonnegative(),
  ended_ms: z.int().nonnegative(),
  // speechEnd to speechComplete.
  asr_latency_ms: z.int().nonnegative(),
  intent: Intent,
  intent_confidence: Confidence,
  // Set when the turn overlapped system speech; intents from such turns are ignored.
  overlapped_say_id: Uuid.nullable(),
  // The answer's ModelCall when intent is question.
  answer_call_id: Uuid.nullable(),
});
export type Utterance = z.infer<typeof Utterance>;
