# How to write a Flo agent prompt

Standing rule for every agent prompt on Attest (set by Thomas, Oct 26, 2026). Work runs as single-unit agent sessions started by Thomas's GO; the five seats no longer run simultaneously.

## Scope

* One unit of work per session: one issue, or one bounded step with a single verifiable outcome.
* A push, dispatch, apply or DOWN ends a unit. Each needs a fresh GO from Thomas, so never chain fix → push → CI → release in one prompt.
* If the steps don't fit on one screen (about 7), split the unit.
* The GOAL must be reachable using only the actions the unit allows. A goal that needs a push in a unit that forbids pushing will loop.

## Template (fixed order)

* **GOAL:** one sentence plus why.
* **READ FIRST:** at most 5 sources (handoff Agent Note, Linear issue, files with paths).
* **VERIFIED STATE:** what was checked before writing the prompt, with ids (commit SHAs, run ids, issue ids, comment ids).
* **STEPS:** S0, S1, … each written as action → done-criterion → evidence required. S0 is always the branch sync: git fetch origin, fast-forward the local branch (--ff-only, clean tree). Done when the local and remote SHAs match the expected values. Evidence: SHAs and git status.
* **OUT OF SCOPE:** explicit list (e.g. push, dispatch, plan/apply, Linear or Notion writes).
* **STOP AND ASK WHEN:** a check fails; a finding is High or above; a choice no step covers; an instruction seems wrong (quote it).
* **REPORT:** every step id as done / not done / blocked with evidence, then findings to file, then questions. Then end the session.

## /goal text

* Written separately from the prompt, for Claude Code's /goal.
* Describes the report that ends the session: which step evidence it contains, or the step where it stopped, plus what must not have happened (e.g. nothing pushed or applied).
* If a unit's plan changes mid-session, provide replacement /goal text.

## Length

* Prompt + /goal combined under 4000 characters.
* Measure with a script (`printf '%s' "$TEXT" | wc -m`, not echo) and state the count.

## Content rules

* Plain tone, reason stated. At most one line of emphasis; no all-caps or CRITICAL/MUST stacks.
* Every decision is made by Thomas and written into the prompt. Never hand a decision to the agent through wording like "kept or squashed, and why".
* Tests exercise the real production path with real values. No placeholders or stubbed paths to make a test pass. New tests go red first, and each new check is shown catching a mutation.
* The agent runs a fresh-context reviewer on its diff before reporting. In a review loop, fix only reproduced Highs after the agreed last round; list the rest for a new unit.
* Anything that must never slip goes in a hook, guardrail or contract test, not just prose.

## State and sessions

* State lives where a cold session can read it: the handoff Agent Note, Linear, git, and a per-unit JSON checklist. The agent may set only status and evidence in the checklist, never add, remove or edit steps.
* Start a fresh session from the handoff after two corrections on the same issue or after any auto-compaction.

## Linear

* Writes happen only on Thomas's GO. The report lists every relation a write adds (Linear auto-links any issue id named in a comment or description). Remove one only on his decision.
