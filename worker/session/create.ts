// Procedure and session creation: a compiled ProcedureDraft becomes a Procedure with minted ids,
// awaiting approval; an approved Procedure starts a Session.
import {
  PROCEDURE_VERSION,
  SESSION_VERSION,
  SessionKind,
  Uuid,
  type ProcedureDraft,
  type Procedure,
  type Session,
} from "@attest/shared";
import { z } from "zod";
import { MAX_SOURCE_CHARS } from "../procedure/compile";
import { CAPTURE_FPS, SEGMENT_MS, SESSION_SPEND_CAP_MICRO_USD, SESSION_TIME_CAP_MS } from "../perception/config";

// Body of POST /api/procedures: the procedure text to compile. Its sha256 is the procedure's source_hash.
export const CompileProcedureRequest = z.object({
  v: z.literal(1),
  source_text: z.string().trim().min(1).max(MAX_SOURCE_CHARS),
});

// Body of POST /api/sessions. Only an approved procedure starts a session.
export const CreateSessionRequest = z.object({
  v: z.literal(1),
  kind: SessionKind,
  procedure_id: Uuid,
  user_agent: z.string().max(512),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>;

// Overlay colors, assigned to objects in procedure order.
const COLORS = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45", "#fabed4"];

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Mints ids for every step, object and rule. The procedure waits for approval; there is no
// operator identity until Access is in place, so approved_by stays null after it too.
export function mintProcedure(draft: ProcedureDraft, sourceHash: string, now: number, compileCallId: string): Procedure {
  const stepIds = draft.steps.map(() => crypto.randomUUID());
  const idOf = (ordinal: number) => {
    const id = stepIds[ordinal - 1];
    if (id === undefined) throw new Error(`no step with ordinal ${String(ordinal)}`);
    return id;
  };
  return {
    v: PROCEDURE_VERSION,
    id: crypto.randomUUID(),
    title: draft.title,
    language: draft.language,
    source: "text",
    source_hash: sourceHash,
    compiled_at: now,
    approved_at: null,
    approved_by: null,
    starting_state: draft.starting_state,
    steps: draft.steps.map((step) => ({
      ...step,
      id: idOf(step.ordinal),
      depends_on: step.depends_on.map(idOf),
      reference_image_key: null,
    })),
    objects: draft.objects.map((object, index) => ({
      ...object,
      id: crypto.randomUUID(),
      color: COLORS[index % COLORS.length] ?? "#ffffff",
    })),
    hazard_rules: draft.hazard_rules.map((rule) => ({ ...rule, id: crypto.randomUUID(), before_step: idOf(rule.before_step) })),
    compile_call_id: compileCallId,
  };
}

export function newSession(procedure: Procedure, request: CreateSessionRequest, now: number): Session {
  return {
    v: SESSION_VERSION,
    id: crypto.randomUUID(),
    procedure_id: procedure.id,
    kind: request.kind,
    // No Recording exists for a replay made from a loose clip.
    recording_id: null,
    state: "created",
    closed_reason: null,
    started_at: null,
    ended_at: null,
    segment_ms: SEGMENT_MS,
    fps: CAPTURE_FPS,
    time_cap_ms: SESSION_TIME_CAP_MS,
    spend_cap_micro_usd: SESSION_SPEND_CAP_MICRO_USD,
    client: { user_agent: request.user_agent, encoder: "webcodecs_h264" },
    // The page shows the recording notice before it creates the session.
    consent_shown_at: now,
  };
}
