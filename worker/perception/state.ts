// The state machine: pure functions from validated observations, gaps and worker confirmations to
// step and hazard states and the events that record each change. The model never sets a state.
//
// Rules (Thomas, Oct 26):
// 1. A step completes when a validated observation says completed at or above the threshold, its
//    depends_on are complete and it isn't blocked.
// 2. When a later step is seen before a step it depends on is complete, that step goes unobserved
//    and the server says "Step N not observed: <instruction>".
// 3. A worker_confirm yes completes an unobserved step (a no returns it to pending).
// 4. A hazard rule is checked only while its step is next: violated blocks the step (severity
//    block) and speaks the rule's message, satisfied clears it.
// 5. A gapped segment changes nothing.
import {
  EVENT_VERSION,
  countWords,
  type EventBase,
  type GapEvent,
  type HazardEvent,
  type HazardState,
  type Observation,
  type Procedure,
  type StepEvent,
  type StepState,
} from "@attest/shared";
import { HAZARD_MIN_CONFIDENCE, STEP_COMPLETE_MIN_CONFIDENCE, STEP_SEEN_MIN_CONFIDENCE } from "./config";

// The parts of a procedure the state machine reads.
export type MachineProcedure = Pick<Procedure, "steps" | "hazard_rules">;

// Stored step states are pending, completed, unobserved or blocked; active is derived for clients.
export interface MachineState {
  steps: StepState[];
  hazards: HazardState[];
}

export interface Say {
  text: string;
  ref: { kind: "step" | "hazard"; id: string };
}

// Where an event comes from: one processed segment, or the latest one for a confirmation.
export interface EventContext {
  session_id: string;
  segment_n: number;
  // Session-relative start of the segment.
  segment_started_ms: number;
  // Wall-clock end of the segment: session started_at + started_ms + duration_ms.
  segment_end_at: number;
  detected_at: number;
  clip_key: string | null;
  newId: () => string;
}

export interface Transition {
  state: MachineState;
  events: (StepEvent | HazardEvent)[];
  says: Say[];
  // Observation entries the validator dropped or downgraded, for the logs.
  rejected: string[];
}

export function initialState(procedure: MachineProcedure): MachineState {
  return {
    steps: procedure.steps.map((step) => ({ step_id: step.id, state: "pending", updated_ms: 0, event_id: null })),
    hazards: procedure.hazard_rules.map((rule) => ({ rule_id: rule.id, state: "armed", updated_ms: 0, event_id: null })),
  };
}

function clone(state: MachineState): MachineState {
  return { steps: state.steps.map((step) => ({ ...step })), hazards: state.hazards.map((hazard) => ({ ...hazard })) };
}

function stepState(state: MachineState, stepId: string): StepState {
  const found = state.steps.find((step) => step.step_id === stepId);
  if (found === undefined) throw new Error(`unknown step ${stepId}`);
  return found;
}

function hazardState(state: MachineState, ruleId: string): HazardState {
  const found = state.hazards.find((hazard) => hazard.rule_id === ruleId);
  if (found === undefined) throw new Error(`unknown hazard rule ${ruleId}`);
  return found;
}

// The next step: the first, in ordinal order, that is neither completed nor unobserved.
export function nextStepId(procedure: MachineProcedure, state: MachineState): string | null {
  for (const step of procedure.steps) {
    const current = stepState(state, step.id).state;
    if (current !== "completed" && current !== "unobserved") return step.id;
  }
  return null;
}

// Step states as clients see them: the next step, when pending, is active.
export function clientStepStates(procedure: MachineProcedure, state: MachineState): StepState[] {
  const next = nextStepId(procedure, state);
  return state.steps.map((step) => (step.step_id === next && step.state === "pending" ? { ...step, state: "active" } : { ...step }));
}

// Plain-text states for the observation prompt.
export function stateText(procedure: Pick<Procedure, "steps" | "hazard_rules">, state: MachineState): string {
  const steps = clientStepStates(procedure, state).map((step) => {
    const ordinal = procedure.steps.find((candidate) => candidate.id === step.step_id)?.ordinal;
    return `step ${String(ordinal)} ${step.state}`;
  });
  const hazards = state.hazards.map((hazard) => `rule ${hazard.rule_id} ${hazard.state}`);
  return [...steps, ...hazards].join("; ");
}

function capWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? words.join(" ") : words.slice(0, max).join(" ");
}

function base(ctx: EventContext, sessionMs: number, source: EventBase["source"], confidence: number | null, rationale: string, key: string): EventBase {
  return {
    v: EVENT_VERSION,
    id: ctx.newId(),
    session_id: ctx.session_id,
    segment_n: ctx.segment_n,
    detected_at: ctx.detected_at,
    session_ms: sessionMs,
    latency_ms: ctx.detected_at - ctx.segment_end_at,
    source,
    confidence,
    rationale: capWords(rationale, 40),
    clip_key: ctx.clip_key,
    tracks_segment_n: null,
    utterance_id: null,
    idempotency_key: key,
  };
}

function eventKey(ctx: EventContext, type: string, id: string): string {
  return `event:${ctx.session_id}:${type}:${id}:${String(ctx.segment_n)}`;
}

export function notObservedText(step: { ordinal: number; instruction: string }): string {
  return capWords(`Step ${String(step.ordinal)} not observed: ${step.instruction}`, 40);
}

type StepObservation = Observation["step_observations"][number];

// Applies one validated observation of a segment whose SAM and Spark calls both succeeded.
// tracks_segment_n is the segment whose Tracks the evidence used.
export function applyObservation(
  procedure: MachineProcedure,
  previous: MachineState,
  observation: Observation,
  ctx: EventContext,
  tracksSegmentN: number,
): Transition {
  const state = clone(previous);
  const events: (StepEvent | HazardEvent)[] = [];
  const says: Say[] = [];
  const rejected: string[] = [];

  // Validator: one observation per known step; completed needs evidence labels.
  const byStep = new Map<string, StepObservation>();
  for (const entry of observation.step_observations) {
    if (!procedure.steps.some((step) => step.id === entry.step_id)) {
      rejected.push(`unknown step ${entry.step_id}`);
    } else if (byStep.has(entry.step_id)) {
      rejected.push(`second observation of step ${entry.step_id}`);
    } else if (entry.state === "completed" && entry.evidence.object_labels.length === 0) {
      rejected.push(`completed with no object labels for step ${entry.step_id}`);
    } else {
      byStep.set(entry.step_id, entry);
    }
  }
  const byRule = new Map<string, Observation["hazards"][number]>();
  for (const entry of observation.hazards) {
    if (!procedure.hazard_rules.some((rule) => rule.id === entry.rule_id)) rejected.push(`unknown rule ${entry.rule_id}`);
    else if (byRule.has(entry.rule_id)) rejected.push(`second observation of rule ${entry.rule_id}`);
    else byRule.set(entry.rule_id, entry);
  }

  const withTracks = <T extends EventBase>(event: T): T => ({ ...event, tracks_segment_n: tracksSegmentN });

  // Rule 4, for the step that is next at this point of the pass.
  const checkHazards = (stepId: string) => {
    for (const rule of procedure.hazard_rules) {
      if (rule.before_step !== stepId) continue;
      const seen = byRule.get(rule.id);
      if (seen === undefined || seen.state === "cannot_tell" || seen.confidence < HAZARD_MIN_CONFIDENCE) continue;
      const hazard = hazardState(state, rule.id);
      const step = stepState(state, stepId);
      const sessionMs = ctx.segment_started_ms + seen.evidence.moment_ms;
      const blocks = rule.severity === "block";
      if (seen.state === "violated" && hazard.state !== "violated") {
        const event: HazardEvent = withTracks({
          ...base(ctx, sessionMs, "observation", seen.confidence, seen.evidence.description, eventKey(ctx, "hazard_violated", rule.id)),
          type: "hazard_violated",
          rule_id: rule.id,
          blocked_step_id: blocks ? stepId : null,
        });
        events.push(event);
        Object.assign(hazard, { state: "violated", updated_ms: sessionMs, event_id: event.id });
        if (blocks) Object.assign(step, { state: "blocked", updated_ms: sessionMs, event_id: event.id });
        says.push({ text: rule.message, ref: { kind: "hazard", id: rule.id } });
      } else if (seen.state === "satisfied" && (hazard.state === "violated" || hazard.state === "armed")) {
        const type = hazard.state === "violated" ? "hazard_cleared" : "hazard_satisfied";
        const event: HazardEvent = withTracks({
          ...base(ctx, sessionMs, "observation", seen.confidence, seen.evidence.description, eventKey(ctx, type, rule.id)),
          type,
          rule_id: rule.id,
          blocked_step_id: null,
        });
        events.push(event);
        Object.assign(hazard, { state: type === "hazard_cleared" ? "cleared" : "satisfied", updated_ms: sessionMs, event_id: event.id });
        // The step stays blocked while another blocking rule on it is still violated.
        const stillBlocked = procedure.hazard_rules.some(
          (other) => other.before_step === stepId && other.severity === "block" && hazardState(state, other.id).state === "violated",
        );
        if (step.state === "blocked" && !stillBlocked) Object.assign(step, { state: "pending", updated_ms: sessionMs, event_id: event.id });
      }
    }
  };

  const isComplete = (stepId: string) => stepState(state, stepId).state === "completed";

  // Rule 4 then rule 1, step by step in ordinal order, so a step that completes makes the next one
  // next within the same segment.
  for (const step of procedure.steps) {
    if (nextStepId(procedure, state) === step.id) checkHazards(step.id);
    const seen = byStep.get(step.id);
    if (seen?.state !== "completed") continue;
    if (!step.depends_on.every(isComplete)) {
      // Validator: completed before its dependencies is downgraded to in_progress.
      rejected.push(`dependency_violation: step ${String(step.ordinal)} completed before its dependencies`);
      byStep.set(step.id, { ...seen, state: "in_progress" });
      continue;
    }
    const current = stepState(state, step.id);
    if (current.state === "completed" || current.state === "blocked" || seen.confidence < STEP_COMPLETE_MIN_CONFIDENCE) continue;
    const sessionMs = ctx.segment_started_ms + seen.evidence.moment_ms;
    const event: StepEvent = withTracks({
      ...base(ctx, sessionMs, "observation", seen.confidence, seen.evidence.description, eventKey(ctx, "step_completed", step.id)),
      type: "step_completed",
      step_id: step.id,
    });
    events.push(event);
    Object.assign(current, { state: "completed", updated_ms: sessionMs, event_id: event.id });
  }

  // Rule 2: a step seen while a step it depends on is not complete leaves that step unobserved.
  for (const step of procedure.steps) {
    const seen = byStep.get(step.id);
    if (seen === undefined || (seen.state !== "in_progress" && seen.state !== "completed") || seen.confidence < STEP_SEEN_MIN_CONFIDENCE) continue;
    for (const dependencyId of step.depends_on) {
      const dependency = procedure.steps.find((candidate) => candidate.id === dependencyId);
      const current = stepState(state, dependencyId);
      if (dependency === undefined || current.state === "completed" || current.state === "unobserved") continue;
      const sessionMs = ctx.segment_started_ms + seen.evidence.moment_ms;
      const rationale = `Step ${String(step.ordinal)} was seen before step ${String(dependency.ordinal)}, which it depends on, was completed.`;
      const event: StepEvent = withTracks({
        ...base(ctx, sessionMs, "rule", seen.confidence, rationale, eventKey(ctx, "step_unobserved", dependencyId)),
        type: "step_unobserved",
        step_id: dependencyId,
      });
      events.push(event);
      Object.assign(current, { state: "unobserved", updated_ms: sessionMs, event_id: event.id });
      says.push({ text: notObservedText(dependency), ref: { kind: "step", id: dependencyId } });
    }
  }

  return { state, events, says, rejected };
}

// Rule 5: a gap is recorded and changes nothing.
export function gapEvent(ctx: EventContext, reason: GapEvent["reason"], affected: GapEvent["affected"], rationale: string): GapEvent {
  return {
    ...base(ctx, ctx.segment_started_ms, "system", null, rationale, `event:${ctx.session_id}:gap:-:${String(ctx.segment_n)}`),
    type: "gap",
    reason,
    affected,
    ended_at: null,
  };
}

export interface ConfirmResult {
  state: MachineState;
  event: StepEvent | null;
  // Why nothing changed, when nothing did.
  ignored: string | null;
}

// Rule 3: the worker's answer about an unobserved step.
export function applyConfirm(
  procedure: MachineProcedure,
  previous: MachineState,
  stepId: string,
  answer: "yes" | "no",
  utteranceId: string | null,
  sessionMs: number,
  ctx: EventContext,
): ConfirmResult {
  const state = clone(previous);
  const step = procedure.steps.find((candidate) => candidate.id === stepId);
  if (step === undefined) return { state: previous, event: null, ignored: "unknown step" };
  const current = stepState(state, stepId);
  if (current.state !== "unobserved") return { state: previous, event: null, ignored: `step ${String(step.ordinal)} is ${current.state}, not unobserved` };
  const type = answer === "yes" ? "step_confirmed_done" : "step_confirmed_not_done";
  const rationale = answer === "yes" ? `The worker confirmed step ${String(step.ordinal)} is done.` : `The worker said step ${String(step.ordinal)} is not done.`;
  const event: StepEvent = {
    ...base(ctx, sessionMs, "worker_confirm", null, rationale, eventKey(ctx, type, stepId)),
    type,
    step_id: stepId,
    utterance_id: utteranceId,
  };
  Object.assign(current, { state: answer === "yes" ? "completed" : "pending", updated_ms: sessionMs, event_id: event.id });
  return { state, event, ignored: null };
}

// How long the browser keeps listening suppressed while a say is spoken.
export function speakingMs(text: string, msPerWord: number): number {
  return countWords(text) * msPerWord;
}
