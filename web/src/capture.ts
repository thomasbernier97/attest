// Camera to standalone MP4 segments: frames from the camera track are thinned to 12.5 fps, encoded
// as H.264 with WebCodecs, and every 4 s of capture is muxed with mp4-muxer into one faststart MP4
// with no audio track. Each segment starts with a keyframe, so it plays on its own.
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

export const SEGMENT_MS = 4_000;
export const CAPTURE_FPS = 12.5;
export const CAPTURE_WIDTH = 1280;
export const CAPTURE_HEIGHT = 720;
const FRAME_US = 1_000_000 / CAPTURE_FPS;
// Constrained Baseline, level 3.1: enough for 1280x720, and no B-frames, so chunks come out in order.
const CODEC = "avc1.42e01f";
const BITRATE = 2_500_000;
// Frames waiting in the encoder past this are dropped rather than queued.
const MAX_ENCODE_QUEUE = 8;
// A last segment shorter than this, cut off by stop(), is not sent.
const MIN_LAST_SEGMENT_MS = 1_000;

export function encoderConfig(width: number, height: number): VideoEncoderConfig {
  return { codec: CODEC, width, height, bitrate: BITRATE, framerate: CAPTURE_FPS, avc: { format: "avc" } };
}

export async function h264Supported(): Promise<boolean> {
  // Frames come from MediaStreamTrackProcessor, which only Chromium browsers have.
  if (typeof VideoEncoder === "undefined" || !("MediaStreamTrackProcessor" in window)) return false;
  const support = await VideoEncoder.isConfigSupported(encoderConfig(CAPTURE_WIDTH, CAPTURE_HEIGHT));
  return support.supported === true;
}

export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    // The encoder's level tops out at 1280x720, so the camera may not go above it.
    video: {
      width: { ideal: CAPTURE_WIDTH, max: CAPTURE_WIDTH },
      height: { ideal: CAPTURE_HEIGHT, max: CAPTURE_HEIGHT },
      frameRate: { ideal: 30 },
    },
  });
}

export interface Segment {
  // Upload number, from 0 with no holes.
  n: number;
  // Capture time of the segment's first frame, from the first frame of the session.
  started_ms: number;
  duration_ms: number;
  frames: number;
  bytes: ArrayBuffer;
}

// Chrome's MediaStreamTrackProcessor, which the DOM types do not have yet.
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack });
  readonly readable: ReadableStream<VideoFrame>;
}

interface OpenSegment {
  n: number;
  muxer: Muxer<ArrayBufferTarget>;
  first_us: number;
  last_us: number;
  frames: number;
}

export class SegmentRecorder {
  private readonly encoder: VideoEncoder;
  private readonly reader: ReadableStreamDefaultReader<VideoFrame>;
  private readonly width: number;
  private readonly height: number;
  private decoderConfig: VideoDecoderConfig | undefined;
  // Segment of each frame sent to the encoder, by timestamp, so its chunk lands in the right file.
  private readonly segmentOf = new Map<number, number>();
  private current: OpenSegment | null = null;
  private firstUs: number | null = null;
  private nextUs = 0;
  private lastEncodedN = -1;
  // Segments sent so far; the server needs n to run 0, 1, 2, ... with no holes.
  private sent = 0;
  private stopped = false;
  private readonly done: Promise<void>;
  droppedFrames = 0;

  constructor(
    track: MediaStreamTrack,
    private readonly onSegment: (segment: Segment) => void,
    private readonly onError: (error: unknown) => void,
  ) {
    const settings = track.getSettings();
    this.width = settings.width ?? CAPTURE_WIDTH;
    this.height = settings.height ?? CAPTURE_HEIGHT;
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        try {
          this.addChunk(chunk, meta);
        } catch (error) {
          this.onError(error);
        }
      },
      error: (error) => {
        this.onError(error);
      },
    });
    this.encoder.configure(encoderConfig(this.width, this.height));
    this.reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
    this.done = this.readFrames().catch((error: unknown) => {
      if (!this.stopped) this.onError(error);
    });
  }

  private async readFrames(): Promise<void> {
    for (;;) {
      const { value: frame, done } = await this.reader.read();
      if (done) return;
      try {
        this.takeFrame(frame);
      } finally {
        frame.close();
      }
    }
  }

  // Keeps one frame per 80 ms of capture and drops the rest.
  private takeFrame(frame: VideoFrame): void {
    if (this.stopped) return;
    this.firstUs ??= frame.timestamp;
    const rel = frame.timestamp - this.firstUs;
    if (rel < this.nextUs) return;
    this.nextUs += FRAME_US;
    // After a stall, start the 80 ms grid again from this frame instead of catching up in a burst.
    if (this.nextUs <= rel) this.nextUs = rel + FRAME_US;
    const n = Math.floor(rel / (SEGMENT_MS * 1000));
    if (this.encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
      this.droppedFrames += 1;
      return;
    }
    // The first frame encoded for a segment is a keyframe; if it was dropped, the next one is.
    const keyFrame = n !== this.lastEncodedN;
    const timed = new VideoFrame(frame, { timestamp: frame.timestamp, duration: FRAME_US });
    this.segmentOf.set(timed.timestamp, n);
    try {
      this.encoder.encode(timed, { keyFrame });
    } finally {
      timed.close();
    }
    this.lastEncodedN = n;
  }

  private addChunk(chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata | undefined): void {
    if (meta?.decoderConfig !== undefined) this.decoderConfig = meta.decoderConfig;
    const n = this.segmentOf.get(chunk.timestamp);
    this.segmentOf.delete(chunk.timestamp);
    if (n === undefined) throw new Error(`no segment for the chunk at ${String(chunk.timestamp)}`);
    if (this.current?.n !== n) {
      this.finishSegment();
      if (chunk.type !== "key") throw new Error(`segment ${String(n)} does not start with a keyframe`);
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: "avc", width: this.width, height: this.height },
        fastStart: "in-memory",
        firstTimestampBehavior: "offset",
      });
      this.current = { n, muxer, first_us: chunk.timestamp, last_us: chunk.timestamp, frames: 0 };
      // Every file needs the decoder config, which the encoder only reports on its first output.
      const config = this.decoderConfig;
      muxer.addVideoChunk(chunk, config === undefined ? meta : { decoderConfig: config });
    } else {
      this.current.muxer.addVideoChunk(chunk, meta);
    }
    this.current.last_us = chunk.timestamp;
    this.current.frames += 1;
  }

  private finishSegment(minMs = 0): void {
    const open = this.current;
    if (open === null) return;
    this.current = null;
    open.muxer.finalize();
    const durationMs = Math.round((open.last_us - open.first_us + FRAME_US) / 1000);
    if (durationMs < minMs) return;
    this.onSegment({
      n: this.sent++,
      started_ms: Math.round((open.first_us - (this.firstUs ?? open.first_us)) / 1000),
      duration_ms: durationMs,
      frames: open.frames,
      bytes: open.muxer.target.buffer,
    });
  }

  // Stops reading frames, encodes what is queued and sends the last segment if it is long enough.
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.reader.cancel().catch(() => undefined);
    await this.done;
    if (this.encoder.state === "configured") await this.encoder.flush();
    this.finishSegment(MIN_LAST_SEGMENT_MS);
    if (this.encoder.state !== "closed") this.encoder.close();
  }
}
