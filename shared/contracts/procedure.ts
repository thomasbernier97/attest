import { z } from "zod";
import { EpochMs, HexColor, LanguageTag, ObjectLabel, Sha256Hex, Uuid, text, words } from "./common";

export const PROCEDURE_DRAFT_VERSION = 1;
export const PROCEDURE_VERSION = 1;

export const CueKind = z.enum(["object_placed", "object_state", "object_motion", "tool_use", "worker_action"]);
export const ConditionKind = z.enum(["object_present", "object_absent", "object_state"]);
export const Severity = z.enum(["block", "warn"]);
export const ProcedureSource = z.enum(["text", "pdf", "photo", "voice"]);

export const ProcedureStepDraft = z.object({
  ordinal: z.int().min(1),
  instruction: text(1, 240),
  expected_objects: z.array(ObjectLabel).max(4),
  completion_cue: text(1, 160),
  cue_kind: CueKind,
  depends_on: z.array(z.int().min(1)),
});
export type ProcedureStepDraft = z.infer<typeof ProcedureStepDraft>;

export const ObjectDraft = z.object({
  label: ObjectLabel,
  display_name: text(1, 40),
  prompt: words(6, 1),
});
export type ObjectDraft = z.infer<typeof ObjectDraft>;

export const HazardRuleDraft = z.object({
  condition: text(1, 160),
  condition_kind: ConditionKind,
  object_label: ObjectLabel,
  before_step: z.int().min(1),
  severity: Severity,
  message: words(20, 1),
});
export type HazardRuleDraft = z.infer<typeof HazardRuleDraft>;

interface Refs {
  steps: readonly { ordinal: number; expected_objects: readonly string[] }[];
  objects: readonly { label: string }[];
  hazard_rules: readonly { object_label: string }[];
}

// Checks shared by the draft and the stored procedure: ordinals are 1..n in order, labels are
// unique, and every label a step or rule names is an object of the procedure.
function checkRefs(procedure: Refs, ctx: z.RefinementCtx): Set<string> {
  procedure.steps.forEach((step, index) => {
    if (step.ordinal !== index + 1) {
      ctx.addIssue({ code: "custom", message: `ordinal must be ${String(index + 1)}`, path: ["steps", index, "ordinal"] });
    }
  });
  const labels = new Set<string>();
  procedure.objects.forEach((object, index) => {
    if (labels.has(object.label)) {
      ctx.addIssue({ code: "custom", message: "duplicate label", path: ["objects", index, "label"] });
    }
    labels.add(object.label);
  });
  procedure.steps.forEach((step, index) => {
    step.expected_objects.forEach((label, labelIndex) => {
      if (!labels.has(label)) {
        ctx.addIssue({ code: "custom", message: "unknown object label", path: ["steps", index, "expected_objects", labelIndex] });
      }
    });
  });
  procedure.hazard_rules.forEach((rule, index) => {
    if (!labels.has(rule.object_label)) {
      ctx.addIssue({ code: "custom", message: "unknown object label", path: ["hazard_rules", index, "object_label"] });
    }
  });
  return labels;
}

export const ProcedureDraft = z
  .object({
    v: z.literal(PROCEDURE_DRAFT_VERSION),
    title: text(1, 120),
    language: LanguageTag,
    // What the camera sees before step 1, from the text's setup; null when the text gives none.
    starting_state: text(1, 400).nullable(),
    steps: z.array(ProcedureStepDraft).min(1).max(30),
    objects: z.array(ObjectDraft).min(1),
    hazard_rules: z.array(HazardRuleDraft).max(8),
  })
  .superRefine((draft, ctx) => {
    checkRefs(draft, ctx);
    draft.steps.forEach((step, index) => {
      step.depends_on.forEach((ordinal, dependencyIndex) => {
        if (ordinal >= step.ordinal) {
          ctx.addIssue({ code: "custom", message: "must name a lower ordinal", path: ["steps", index, "depends_on", dependencyIndex] });
        }
      });
    });
    draft.hazard_rules.forEach((rule, index) => {
      if (rule.before_step > draft.steps.length) {
        ctx.addIssue({ code: "custom", message: "unknown step ordinal", path: ["hazard_rules", index, "before_step"] });
      }
    });
  });
export type ProcedureDraft = z.infer<typeof ProcedureDraft>;

export const ProcedureStep = ProcedureStepDraft.extend({
  id: Uuid,
  depends_on: z.array(Uuid),
  reference_image_key: z.string().nullable(),
});
export type ProcedureStep = z.infer<typeof ProcedureStep>;

export const ProcedureObject = ObjectDraft.extend({
  id: Uuid,
  color: HexColor,
});
export type ProcedureObject = z.infer<typeof ProcedureObject>;

export const HazardRule = HazardRuleDraft.extend({
  id: Uuid,
  before_step: Uuid,
});
export type HazardRule = z.infer<typeof HazardRule>;

export const Procedure = z
  .object({
    v: z.literal(PROCEDURE_VERSION),
    id: Uuid,
    title: text(1, 120),
    language: LanguageTag,
    source: ProcedureSource,
    source_hash: Sha256Hex,
    compiled_at: EpochMs,
    approved_at: EpochMs.nullable(),
    approved_by: z.string().nullable(),
    starting_state: text(1, 400).nullable(),
    steps: z.array(ProcedureStep).min(1).max(30),
    objects: z.array(ProcedureObject).min(1),
    hazard_rules: z.array(HazardRule).max(8),
    // The compile ModelCall; null for a draft compiled outside the server.
    compile_call_id: Uuid.nullable(),
  })
  .superRefine((procedure, ctx) => {
    checkRefs(procedure, ctx);
    for (const key of ["steps", "objects", "hazard_rules"] as const) {
      const ids = new Set<string>();
      procedure[key].forEach((item, index) => {
        if (ids.has(item.id)) ctx.addIssue({ code: "custom", message: "duplicate id", path: [key, index, "id"] });
        ids.add(item.id);
      });
    }
    const ordinals = new Map(procedure.steps.map((step) => [step.id, step.ordinal]));
    procedure.steps.forEach((step, index) => {
      step.depends_on.forEach((id, dependencyIndex) => {
        const ordinal = ordinals.get(id);
        if (ordinal === undefined || ordinal >= step.ordinal) {
          ctx.addIssue({ code: "custom", message: "must name a step with a lower ordinal", path: ["steps", index, "depends_on", dependencyIndex] });
        }
      });
    });
    procedure.hazard_rules.forEach((rule, index) => {
      if (!ordinals.has(rule.before_step)) {
        ctx.addIssue({ code: "custom", message: "unknown step id", path: ["hazard_rules", index, "before_step"] });
      }
    });
  });
export type Procedure = z.infer<typeof Procedure>;
