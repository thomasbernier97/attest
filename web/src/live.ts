// One live session from the browser: one WebSocket that reconnects and resumes from the last event
// it saw, and segment uploads sent one at a time in order, each retried while the error is retryable
// for up to UPLOAD_RETRY_MS, long enough to ride out a network cut of 20 s.
import { ServerMessage } from "@attest/shared";
import { errorFrom } from "./api";
import type { Segment } from "./capture";

const RECONNECT_MAX_MS = 10_000;
const UPLOAD_RETRY_MS = 60_000;
const UPLOAD_BACKOFF_MAX_MS = 5_000;
// One attempt that hangs (a cut that stalls rather than fails) is abandoned after this.
const UPLOAD_ATTEMPT_MAX_MS = 20_000;

export interface LogEntry {
  at: number;
  // "server" is a message from the socket; the rest are this page's own notes.
  kind: "server" | "upload" | "socket" | "error";
  type: string;
  text: string;
  raw: unknown;
}

export interface LiveStatus {
  socket: "connecting" | "open" | "closed";
  segments_sent: number;
  segments_failed: number;
  session_micro_usd: number | null;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class LiveSession {
  private ws: WebSocket | null = null;
  private lastEventId: string | null = null;
  private connects = 0;
  private reconnectMs = 1_000;
  private closing = false;
  private uploads: Promise<void> = Promise.resolve();
  private uploadsBroken = false;
  status: LiveStatus = { socket: "connecting", segments_sent: 0, segments_failed: 0, session_micro_usd: null };

  constructor(
    private readonly sessionId: string,
    private readonly token: string,
    private readonly onLog: (entry: LogEntry) => void,
    private readonly onStatus: (status: LiveStatus) => void,
  ) {
    this.connect();
  }

  private log(kind: LogEntry["kind"], type: string, text: string, raw: unknown = null): void {
    this.onLog({ at: Date.now(), kind, type, text, raw });
  }

  private setStatus(change: Partial<LiveStatus>): void {
    this.status = { ...this.status, ...change };
    this.onStatus(this.status);
  }

  private connect(): void {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${scheme}://${location.host}/api/sessions/${this.sessionId}/ws?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    this.setStatus({ socket: "connecting" });
    ws.addEventListener("open", () => {
      this.reconnectMs = 1_000;
      this.setStatus({ socket: "open" });
      this.log("socket", "open", this.connects === 0 ? "connected" : "reconnected");
      // The server sends session_state on connect; after a reconnect, resume also replays the events missed.
      if (this.connects > 0) ws.send(JSON.stringify({ v: 1, type: "resume", last_event_id: this.lastEventId }));
      this.connects += 1;
    });
    ws.addEventListener("message", (event) => {
      this.receive(String(event.data));
    });
    ws.addEventListener("close", (event) => {
      this.setStatus({ socket: "closed" });
      this.log("socket", "close", `closed (${String(event.code)})`);
      if (this.closing) return;
      const wait = this.reconnectMs;
      this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS);
      setTimeout(() => {
        if (!this.closing) this.connect();
      }, wait);
    });
  }

  private receive(data: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      this.log("error", "unparsed", data.slice(0, 200));
      return;
    }
    const parsed = ServerMessage.safeParse(raw);
    if (!parsed.success) {
      this.log("error", "invalid", `a server message failed validation: ${parsed.error.message.slice(0, 200)}`, raw);
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      // last_event_id comes only from events this page has received: session_state carries the
      // server's latest, and taking it would skip events a resume is still replaying.
      case "step_event":
        this.lastEventId = message.step_event.id;
        break;
      case "hazard_event":
        this.lastEventId = message.hazard_event.id;
        break;
      case "gap":
        this.lastEventId = message.gap.id;
        break;
      case "spend":
        this.setStatus({ session_micro_usd: message.session_micro_usd });
        break;
      default:
        break;
    }
    this.log("server", message.type, describe(message), message);
  }

  // Queues the segment behind the ones before it; the server accepts n only after n - 1.
  upload(segment: Segment): void {
    this.uploads = this.uploads.then(() =>
      this.put(segment).catch((error: unknown) => {
        this.uploadsBroken = true;
        this.setStatus({ segments_failed: this.status.segments_failed + 1 });
        this.log("error", "upload", `segment ${String(segment.n)} failed: ${error instanceof Error ? error.message : String(error)}`);
      }),
    );
  }

  private async put(segment: Segment): Promise<void> {
    if (this.uploadsBroken) {
      this.setStatus({ segments_failed: this.status.segments_failed + 1 });
      this.log("upload", "skipped", `segment ${String(segment.n)} not sent: an earlier segment failed`);
      return;
    }
    const sha256 = await sha256Hex(segment.bytes);
    const firstAttemptAt = Date.now();
    for (let attempt = 1; ; attempt += 1) {
      let retryable = true;
      let detail: string;
      try {
        const response = await fetch(`/api/sessions/${this.sessionId}/segments/${String(segment.n)}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "video/mp4",
            "X-Segment-Started-Ms": String(segment.started_ms),
            "X-Segment-Duration-Ms": String(segment.duration_ms),
            "X-Segment-Sha256": sha256,
          },
          body: segment.bytes,
          signal: AbortSignal.timeout(Math.max(1_000, Math.min(UPLOAD_ATTEMPT_MAX_MS, firstAttemptAt + UPLOAD_RETRY_MS - Date.now()))),
        });
        if (response.ok) {
          this.setStatus({ segments_sent: this.status.segments_sent + 1 });
          const kb = Math.round(segment.bytes.byteLength / 1024);
          this.log(
            "upload",
            String(response.status),
            `segment ${String(segment.n)}: ${String(segment.frames)} frames, ${String(segment.duration_ms)} ms from ${String(segment.started_ms)} ms, ${String(kb)} KB`,
          );
          return;
        }
        const error = await errorFrom(response);
        retryable = error.body.retryable;
        detail = error.message;
      } catch (error) {
        detail = error instanceof Error ? error.message : String(error);
      }
      const backoff = Math.min(1_000 * 2 ** (attempt - 1), UPLOAD_BACKOFF_MAX_MS);
      if (!retryable || Date.now() + backoff - firstAttemptAt > UPLOAD_RETRY_MS) {
        this.uploadsBroken = true;
        this.setStatus({ segments_failed: this.status.segments_failed + 1 });
        this.log("error", "upload", `segment ${String(segment.n)} failed: ${detail}`);
        return;
      }
      this.log("upload", "retry", `segment ${String(segment.n)} attempt ${String(attempt)} failed: ${detail}`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  // Waits for queued uploads, then closes the socket after the server has had time to answer.
  async close(waitMs: number): Promise<void> {
    await this.uploads;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.closing = true;
    this.ws?.close(1000, "done");
  }
}

// One line per message; tracks show each object's confidence and box count instead of every box.
function describe(message: ServerMessage): string {
  switch (message.type) {
    case "tracks":
      return `n ${String(message.n)}: ${message.objects
        .map((object) => `${object.label} ${object.confidence === null ? "none" : object.confidence.toFixed(2)} (${String(object.boxes.length)} boxes)`)
        .join(", ")}`;
    case "session_state":
      return `state ${message.session.state}, next segment ${String(message.next_segment_n)}, steps ${message.steps.map((step) => step.state).join(" ")}`;
    case "segment_ack":
      return `n ${String(message.n)} ${message.state}`;
    case "spend":
      return `session $${(message.session_micro_usd / 1e6).toFixed(4)}, day $${(message.daily_micro_usd / 1e6).toFixed(4)}`;
    default:
      // The payload without the envelope.
      return JSON.stringify(Object.fromEntries(Object.entries(message).filter(([key]) => !["v", "type", "server_at"].includes(key))));
  }
}
