// Response to PUT /api/sessions/:id/segments/:n: 202 on first upload, 200 with the same body on a
// repeat with the same sha256.
import { z } from "zod";
import { SegmentN } from "./common";

export const SEGMENT_UPLOAD_VERSION = 1;

export const SegmentUploadResponse = z.object({
  v: z.literal(SEGMENT_UPLOAD_VERSION),
  n: SegmentN,
  r2_key: z.string(),
  file_id: z.string(),
  state: z.literal("queued"),
});
export type SegmentUploadResponse = z.infer<typeof SegmentUploadResponse>;
