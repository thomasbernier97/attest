// Thresholds and limits for the segment pipeline and the state machine. Contracts never carry these.

export const THRESHOLDS_VERSION = "2026-10-27";

// Rule 1: a validated "completed" observation at or above this completes the step.
export const STEP_COMPLETE_MIN_CONFIDENCE = 0.7;
// Rule 2: an observation of a step at or above this counts as the step being seen. Higher than
// rule 1's, because a skip is spoken aloud (try 2 marked steps 2 and 3 unobserved on a step 4 "in
// progress" at 0.85 while the bracket lay where the setup put it).
export const STEP_SEEN_MIN_CONFIDENCE = 0.9;
// Rule 4: a hazard observation at or above this changes the rule's state.
export const HAZARD_MIN_CONFIDENCE = 0.7;

export const SEGMENT_MS = 4_000;
export const CAPTURE_FPS = 12.5;
export const SESSION_TIME_CAP_MS = 600_000;

// A SAM or Spark call that takes longer becomes a gap.
export const MODEL_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 30_000;
export const SPARK_EFFORT = "minimal";
// Cap on Spark's output tokens, reasoning included: twice the largest output (1,034 tokens) over 30
// calls on 07aa1774's segments. A reply cut off at the cap is incomplete, so the segment is a gap.
export const SPARK_MAX_OUTPUT_TOKENS = 2_068;
// Steps after the next one that a segment asks about; SAM tracks only their objects.
export const WINDOW_STEPS_AFTER_NEXT = 2;
// Segment summaries Spark sees from the segments before this one.
export const RECENT_SUMMARIES = 3;
// Segments whose SAM and Spark calls may run at once. A segment takes about 8 s against one every
// 4 s (live run 07aa1774), so one at a time falls behind; results are still applied in order.
export const SEGMENTS_IN_FLIGHT = 3;

// Spend caps, checked before a segment's calls against the worst case for that segment.
export const SESSION_SPEND_CAP_MICRO_USD = 15_000_000;
export const DAILY_SPEND_CAP_MICRO_USD = 30_000_000;
// Worst-case Spark usage for one segment, for the spend check.
export const SPARK_WORST_CASE_TOKENS = { tokens_in: 20_000, tokens_out: SPARK_MAX_OUTPUT_TOKENS };
// Speaking time the browser keeps listening suppressed for, per word of a say message.
export const SAY_MS_PER_WORD = 400;
