// WebSocket messages from the browser to the worker: JSON text frames, one message per frame.
import { z } from "zod";
import { EpochMs, Uuid } from "./common";

export const CLIENT_MESSAGE_VERSION = 1;

const v = z.literal(CLIENT_MESSAGE_VERSION);

export const AudioMessage = z.object({
  v,
  type: z.literal("audio"),
  // 16 kHz, mono, signed 16-bit little-endian; 100 ms is 3200 bytes.
  pcm16: z.base64(),
  // Session-relative capture time of the first sample.
  ms: z.int().nonnegative(),
});

export const WorkerConfirmMessage = z.object({
  v,
  type: z.literal("worker_confirm"),
  step_id: Uuid,
  answer: z.enum(["yes", "no"]),
  via: z.enum(["voice", "tap"]),
  utterance_id: Uuid.nullable(),
});

// First message after a reconnect.
export const ResumeMessage = z.object({
  v,
  type: z.literal("resume"),
  last_event_id: Uuid.nullable(),
});

export const PingMessage = z.object({
  v,
  type: z.literal("ping"),
  sent_at: EpochMs,
});

export const EndMessage = z.object({
  v,
  type: z.literal("end"),
  reason: z.enum(["worker", "operator"]),
});

export const ClientMessage = z.discriminatedUnion("type", [
  AudioMessage,
  WorkerConfirmMessage,
  ResumeMessage,
  PingMessage,
  EndMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;
