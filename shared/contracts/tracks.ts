import { z } from "zod";
import { Confidence, ObjectLabel, SegmentN, Uuid } from "./common";

export const TRACKS_VERSION = 1;

export const TrackFrame = z.object({
  t_ms: z.int().nonnegative(),
  // [x1, y1, x2, y2] in pixels.
  box: z.tuple([z.int(), z.int(), z.int(), z.int()]),
  mask_key: z.string().nullable(),
});
export type TrackFrame = z.infer<typeof TrackFrame>;

export const TrackedObject = z.object({
  label: ObjectLabel,
  prompt: z.string(),
  model_call_id: Uuid,
  // Mean over frames with a box; null when no frame has one.
  confidence: Confidence.nullable(),
  // Frames with a box divided by frames.
  present_ratio: z.number().min(0).max(1),
  // Empty when SAM returns no matches; that is a valid result, not a gap.
  frames: z.array(TrackFrame),
});
export type TrackedObject = z.infer<typeof TrackedObject>;

export const Tracks = z.object({
  v: z.literal(TRACKS_VERSION),
  session_id: Uuid,
  segment_n: SegmentN,
  file_id: z.string(),
  // Positive, not an integer: capture runs at 12.5 fps.
  fps: z.number().positive(),
  frame_w: z.int().positive(),
  frame_h: z.int().positive(),
  objects: z.array(TrackedObject),
  // First request sent to last response completed.
  latency_ms: z.int().nonnegative(),
});
export type Tracks = z.infer<typeof Tracks>;
