// One Durable Object per session. It holds the session's working state in its own storage, accepts
// segments strictly in order, processes them one at a time from an alarm (SAM and Spark in
// parallel, then the state machine), persists Tracks, events and ModelCall rows to D1, and
// broadcasts everything on the session's WebSockets in persistence order.
import { DurableObject } from "cloudflare:workers";
import {
  ClientMessage,
  SEGMENT_UPLOAD_VERSION,
  SERVER_MESSAGE_VERSION,
  ServerMessage,
  type ErrorBody,
  type Procedure,
  type SegmentUploadResponse,
  TimelineEvent,
  type Session,
} from "@attest/shared";
import type { Env } from "../env";
import { callCost } from "../meta/cost";
import { uploadFile } from "../meta/files";
import {
  DAILY_SPEND_CAP_MICRO_USD,
  MODEL_TIMEOUT_MS,
  RECENT_SUMMARIES,
  SAY_MS_PER_WORD,
  SPARK_WORST_CASE_TOKENS,
} from "../perception/config";
import { runSegment, tracksSummary, windowObjects } from "../perception/segment";
import {
  applyConfirm,
  applyObservation,
  clientStepStates,
  gapEvent,
  initialState,
  observeWindow,
  restrictToWindow,
  speakingMs,
  stateText,
  type EventContext,
  type MachineState,
  type Say,
} from "../perception/state";
import {
  eventsAfter,
  insertEvent,
  insertModelCall,
  insertSegment,
  insertTracks,
  spendSoFar,
  updateSegmentState,
  updateSession,
  type SegmentRow,
} from "./db";
import { errorBody, ERROR_STATUS } from "./errors";
import { mp4FrameSize } from "./mp4";

type SegmentRecord = Omit<SegmentRow, "session_id">;

interface Stored {
  session: Session;
  procedure: Procedure;
  machine: MachineState;
  // Accepted segments; n runs 0, 1, 2, ... with no holes.
  segments: SegmentRecord[];
  next_process_n: number;
  // Segment summaries from Spark, oldest first, at most RECENT_SUMMARIES.
  summaries: string[];
  previous_tracks: string | null;
  last_event_id: string | null;
}

export interface SegmentPut {
  n: number;
  sha256: string;
  started_ms: number;
  duration_ms: number;
  bytes: ArrayBuffer;
}

export type PutSegmentResult = { status: 200 | 202; body: SegmentUploadResponse } | { status: number; error: ErrorBody };

// Messages without the envelope, which send() adds.
type Outgoing = ServerMessage extends infer M ? (M extends ServerMessage ? Omit<M, "v" | "server_at"> : never) : never;

function failure(code: ErrorBody["code"], message: string, retryable = false): PutSegmentResult {
  return { status: ERROR_STATUS[code], error: errorBody(code, message, retryable) };
}

function eventMessage(event: TimelineEvent): Outgoing {
  if (event.type === "gap") return { type: "gap", gap: event };
  if ("rule_id" in event) return { type: "hazard_event", hazard_event: event };
  return { type: "step_event", step_event: event };
}

export class SessionDO extends DurableObject<Env> {
  private stored: Stored | null = null;
  // Segment numbers whose upload is in progress, so a concurrent repeat cannot upload twice.
  private uploading = new Set<number>();
  // Events are persisted and broadcast one at a time, in order.
  private emitting: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.stored = (await ctx.storage.get<Stored>("state")) ?? null;
    });
  }

  private async save(): Promise<void> {
    if (this.stored !== null) await this.ctx.storage.put("state", this.stored);
  }

  async init(session: Session, procedure: Procedure): Promise<void> {
    if (this.stored !== null) return;
    this.stored = {
      session,
      procedure,
      machine: initialState(procedure),
      segments: [],
      next_process_n: 0,
      summaries: [],
      previous_tracks: null,
      last_event_id: null,
    };
    await this.save();
  }

  async putSegment(put: SegmentPut): Promise<PutSegmentResult> {
    const st = this.stored;
    if (st === null) return failure("not_found", "no such session");
    const { session } = st;
    const response = (segment: SegmentRecord): SegmentUploadResponse => ({
      v: SEGMENT_UPLOAD_VERSION,
      n: segment.n,
      r2_key: segment.r2_key,
      file_id: segment.file_id,
      state: "queued",
    });
    const existing = st.segments.find((segment) => segment.n === put.n);
    if (existing !== undefined) {
      return existing.sha256 === put.sha256
        ? { status: 200, body: response(existing) }
        : failure("conflict", `segment ${String(put.n)} was already accepted with a different sha256`);
    }
    if (session.state === "closed") return failure("invalid_request", "the session is closed");
    if (put.n !== st.segments.length) return failure("invalid_request", `expected segment ${String(st.segments.length)}`);
    if (this.uploading.has(put.n)) return failure("conflict", `segment ${String(put.n)} is being uploaded`, true);
    const now = Date.now();
    if (session.started_at !== null && now - session.started_at > session.time_cap_ms) {
      return failure("invalid_request", "the session reached its time cap");
    }
    const size = mp4FrameSize(put.bytes);
    if (size === null) return failure("invalid_request", "the body is not an MP4 with a video track");

    this.uploading.add(put.n);
    let fileId: string;
    const r2Key = `sessions/${session.id}/segments/${String(put.n)}.mp4`;
    try {
      await this.env.MEDIA.put(r2Key, put.bytes, { httpMetadata: { contentType: "video/mp4" }, sha256: put.sha256 });
      const upload = await uploadFile(
        { apiKey: this.env.META_API_KEY, requestsLeft: 1 },
        new Blob([put.bytes], { type: "video/mp4" }),
        `${session.id}-${String(put.n)}.mp4`,
      );
      fileId = upload.file.id;
    } catch (error) {
      console.error("segment upload failed", put.n, error instanceof Error ? error.name : error);
      return failure("upload_failed", "the segment could not be stored", true);
    } finally {
      this.uploading.delete(put.n);
    }

    const record: SegmentRecord = {
      n: put.n,
      sha256: put.sha256,
      r2_key: r2Key,
      file_id: fileId,
      started_ms: put.started_ms,
      duration_ms: put.duration_ms,
      frame_w: size.width,
      frame_h: size.height,
      received_at: Date.now(),
      state: "queued",
    };
    st.segments.push(record);
    const starting = st.session.started_at === null;
    if (starting) st.session = { ...st.session, state: "running", started_at: record.received_at };
    await this.save();
    await insertSegment(this.env.DB, { session_id: session.id, ...record });
    if (starting) await updateSession(this.env.DB, st.session);
    this.broadcast({ type: "segment_ack", n: put.n, state: "queued" });
    await this.ctx.storage.setAlarm(Date.now());
    return { status: 202, body: response(record) };
  }

  // Processes queued segments in order, one at a time.
  override async alarm(): Promise<void> {
    const st = this.stored;
    if (st === null) return;
    for (;;) {
      const segment = st.segments.find((candidate) => candidate.n === st.next_process_n);
      if (segment === undefined) return;
      try {
        await this.process(st, segment);
      } catch (error) {
        // A failure here is ours, not a model's; the segment is still a gap and nothing changes.
        console.error("segment processing failed", segment.n, error);
        st.previous_tracks = null;
        await this.finish(st, segment, gapEvent(this.context(st, segment), "model_error", [], "The server failed while processing this segment."));
      }
      st.next_process_n = segment.n + 1;
      await this.save();
    }
  }

  private context(st: Stored, segment: SegmentRecord): EventContext {
    const startedAt = st.session.started_at ?? segment.received_at;
    return {
      session_id: st.session.id,
      segment_n: segment.n,
      segment_started_ms: segment.started_ms,
      segment_end_at: startedAt + segment.started_ms + segment.duration_ms,
      detected_at: Date.now(),
      clip_key: segment.r2_key,
      newId: () => crypto.randomUUID(),
    };
  }

  private worstCaseCost(st: Stored, segment: SegmentRecord, samCalls: number): number {
    const frames = Math.ceil((Math.max(segment.duration_ms, st.session.segment_ms) * st.session.fps) / 1000);
    const usage = { tokens_in: 0, tokens_cached: 0, tokens_out: 0, media_units: 0, media_unit_kind: "none" } as const;
    const sam = callCost({ ...usage, model: "sam-3.1", media_units: frames, media_unit_kind: "frames" });
    const spark = callCost({ ...usage, model: "muse-spark-1.3", ...SPARK_WORST_CASE_TOKENS });
    return sam * samCalls + spark;
  }

  private async process(st: Stored, segment: SegmentRecord): Promise<void> {
    const { session, procedure } = st;
    segment.state = "processing";
    await this.save();
    await updateSegmentState(this.env.DB, session.id, segment.n, "processing");
    this.broadcast({ type: "segment_ack", n: segment.n, state: "processing" });

    // The steps, rules and objects this segment asks about, from the machine as it stands now.
    const window = observeWindow(procedure, st.machine);
    if (window.step_ids.length === 0) {
      // No step is left to observe, so the segment is not sent to SAM or Spark.
      st.previous_tracks = null;
      await this.finish(st, segment, null);
      return;
    }
    const samCalls = windowObjects(procedure, window).length;
    const spend = await spendSoFar(this.env.DB, session.id, Date.now());
    const worst = this.worstCaseCost(st, segment, samCalls);
    if (spend.session + worst > session.spend_cap_micro_usd || spend.daily + worst > DAILY_SPEND_CAP_MICRO_USD) {
      st.previous_tracks = null;
      const rationale = "The spend cap would be passed, so the segment was not sent to SAM or Spark.";
      await this.finish(st, segment, gapEvent(this.context(st, segment), "spend_cap", ["sam", "spark"], rationale));
      return;
    }

    const previousTracks = st.previous_tracks;
    // From here on the previous segment is this one: its tracks, or none when SAM failed on it.
    st.previous_tracks = null;
    const result = await runSegment(
      { apiKey: this.env.META_API_KEY, requestsLeft: samCalls + 1 },
      {
        session_id: session.id,
        segment_n: segment.n,
        file_id: segment.file_id,
        fps: session.fps,
        segment_ms: segment.duration_ms,
        nominal_segment_ms: session.segment_ms,
        frame_w: segment.frame_w,
        frame_h: segment.frame_h,
        procedure,
        state_text: stateText(procedure, st.machine),
        window,
        recent_summaries: st.summaries,
        previous_tracks: previousTracks,
        timeout_ms: MODEL_TIMEOUT_MS,
      },
    );
    for (const call of result.calls) await insertModelCall(this.env.DB, call);

    if (result.tracks !== null) {
      const tracks = result.tracks;
      const key = `sessions/${session.id}/tracks/${String(segment.n)}.json`;
      await this.env.MEDIA.put(key, JSON.stringify(tracks), { httpMetadata: { contentType: "application/json" } });
      await insertTracks(this.env.DB, tracks, key);
      st.previous_tracks = tracksSummary(tracks);
      this.broadcast({
        type: "tracks",
        n: segment.n,
        frame_w: tracks.frame_w,
        frame_h: tracks.frame_h,
        objects: tracks.objects.map((object) => ({
          label: object.label,
          color: procedure.objects.find((candidate) => candidate.label === object.label)?.color ?? "#ffffff",
          confidence: object.confidence,
          boxes: object.frames.map((frame) => {
            const [x1, y1, x2, y2] = frame.box;
            return { t_ms: frame.t_ms, x1, y1, x2, y2 };
          }),
        })),
      });
    }

    const ctx = this.context(st, segment);
    if (result.gap !== null || result.observation === null) {
      const gap = result.gap ?? { reason: "model_error" as const, affected: ["spark" as const], detail: "Spark returned no observation" };
      await this.finish(st, segment, gapEvent(ctx, gap.reason, gap.affected, `No observation for this segment: ${gap.detail}.`));
      return;
    }

    // State changes are applied to the machine as it stands now, after the awaits above, and only
    // from the entries about the window this segment asked about.
    const windowed = restrictToWindow(result.observation, window);
    const transition = applyObservation(procedure, st.machine, windowed.observation, ctx, segment.n);
    st.machine = transition.state;
    st.summaries = [...st.summaries, result.observation.segment_summary].slice(-RECENT_SUMMARIES);
    console.log("observation", segment.n, JSON.stringify(result.observation));
    for (const rejected of [...windowed.rejected, ...transition.rejected]) console.log("observation rejected", segment.n, rejected);
    await this.save();
    await this.finish(st, segment, null, transition.events, transition.says);
  }

  private async finish(st: Stored, segment: SegmentRecord, gap: TimelineEvent | null, events: TimelineEvent[] = [], says: Say[] = []): Promise<void> {
    if (gap !== null) {
      // Spark's next prompt says this segment was not observed rather than skipping over it.
      st.summaries = [...st.summaries, `Segment ${String(segment.n)} was not observed.`].slice(-RECENT_SUMMARIES);
    }
    for (const event of gap === null ? events : [gap]) await this.emit(event);
    for (const say of says) this.say(st, say);
    segment.state = gap === null ? "done" : "gap";
    await this.save();
    await updateSegmentState(this.env.DB, st.session.id, segment.n, segment.state);
    this.broadcast({ type: "segment_ack", n: segment.n, state: segment.state });
    const spend = await spendSoFar(this.env.DB, st.session.id, Date.now());
    this.broadcast({ type: "spend", session_micro_usd: spend.session, daily_micro_usd: spend.daily, cap_micro_usd: st.session.spend_cap_micro_usd });
  }

  // Persists the event, then broadcasts it; a duplicate key is neither stored again nor resent.
  private emit(event: TimelineEvent): Promise<void> {
    const run = this.emitting.then(async () => {
      const { event: stored, inserted } = await insertEvent(this.env.DB, TimelineEvent.parse(event));
      if (!inserted) {
        if (JSON.stringify(stored) !== JSON.stringify(event)) console.error("event conflict; the first write wins", event.idempotency_key);
        return;
      }
      if (this.stored !== null) this.stored.last_event_id = stored.id;
      await this.save();
      this.broadcast(eventMessage(stored));
    });
    this.emitting = run.catch(() => undefined);
    return run;
  }

  private sessionMsNow(st: Stored): number {
    return st.session.started_at === null ? 0 : Date.now() - st.session.started_at;
  }

  private say(st: Stored, say: Say): void {
    this.broadcast({
      type: "say",
      id: crypto.randomUUID(),
      text: say.text,
      language: st.procedure.language,
      ref: say.ref,
      ends_listening_until_ms: this.sessionMsNow(st) + speakingMs(say.text, SAY_MS_PER_WORD),
    });
  }

  private sessionState(st: Stored): Outgoing {
    return {
      type: "session_state",
      session: st.session,
      procedure_id: st.procedure.id,
      steps: clientStepStates(st.procedure, st.machine),
      hazards: st.machine.hazards,
      next_segment_n: st.segments.length,
      last_event_id: st.last_event_id,
    };
  }

  private serialize(message: Outgoing): string | null {
    const parsed = ServerMessage.safeParse({ v: SERVER_MESSAGE_VERSION, server_at: Date.now(), ...message });
    if (!parsed.success) {
      console.error("server message failed validation", message.type, parsed.error.message);
      return null;
    }
    return JSON.stringify(parsed.data);
  }

  private send(ws: WebSocket, message: Outgoing): void {
    const text = this.serialize(message);
    if (text !== null) ws.send(text);
  }

  private broadcast(message: Outgoing): void {
    const text = this.serialize(message);
    if (text === null) return;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // A socket closing mid-send is dropped; the client resumes with its last event id.
      }
    }
  }

  override fetch(request: Request): Response {
    const st = this.stored;
    if (st === null) return Response.json({ error: errorBody("not_found", "no such session") }, { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ error: errorBody("invalid_request", "expected a WebSocket upgrade") }, { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    this.send(server, this.sessionState(st));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const st = this.stored;
    if (st === null) return;
    let raw: unknown;
    try {
      raw = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      raw = null;
    }
    const parsed = ClientMessage.safeParse(raw);
    if (!parsed.success) {
      this.send(ws, { type: "error", error: errorBody("invalid_request", "not a valid client message") });
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "ping":
        this.send(ws, { type: "pong", sent_at: message.sent_at });
        return;
      case "resume": {
        this.send(ws, this.sessionState(st));
        for (const event of await eventsAfter(this.env.DB, st.session.id, message.last_event_id)) this.send(ws, eventMessage(event));
        return;
      }
      case "worker_confirm": {
        const last = st.segments.filter((segment) => segment.state === "done" || segment.state === "gap").at(-1);
        if (last === undefined) {
          this.send(ws, { type: "error", error: errorBody("invalid_request", "no segment has been processed yet") });
          return;
        }
        const result = applyConfirm(st.procedure, st.machine, message.step_id, message.answer, message.utterance_id, this.sessionMsNow(st), this.context(st, last));
        if (result.event === null) {
          this.send(ws, { type: "error", error: errorBody("invalid_request", result.ignored ?? "confirmation ignored") });
          return;
        }
        st.machine = result.state;
        await this.save();
        await this.emit(result.event);
        return;
      }
      case "audio":
      case "end":
        this.send(ws, { type: "error", error: errorBody("invalid_request", `${message.type} is not handled yet`) });
        return;
    }
  }

  override webSocketClose(ws: WebSocket): void {
    try {
      ws.close(1000, "closed");
    } catch {
      // Already closed by the runtime.
    }
  }
}
