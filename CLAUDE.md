# Attest agent protocol

Attest is a camera supervisor that attests, with evidence, that each step of a written procedure was done. Built for the Meta Global AI Developer Hackathon; all code is written after 12:00 ET Oct 26, 2026.

## Sources, in priority order

When two sources disagree, the higher one wins; report the conflict, don't resolve it silently.

1. The Official Rules (the Participant Guide and the legal Official Rules).
2. `docs/spec.md`, with `docs/contracts.md` the field-level authority for every contract.
3. The repo and the deployed app at tryattest.dev.
4. Meta's docs, read through Context7 (`/websites/dev_meta_ai`), never from memory.
5. The unit's Linear issue and its prompt.

## Session rules

- Prompts and sessions follow `docs/agent-prompts.md`: one unit of work per session, started by Thomas's GO. A push, dispatch, apply or DOWN ends the unit.
- State lives where a cold session can read it: `AGENT_NOTES.md`, Linear, git, and the unit's checklist in `.units/<unit>.json` (git-ignored). In the checklist, set only status and evidence; never add, remove or edit steps.
- Read the newest `AGENT_NOTES.md` entries before starting; add a handoff entry before the unit ends.
- Run a fresh-context reviewer on your diff before reporting.
- Linear and Notion writes happen only on Thomas's GO.
- Start a fresh session from the handoff after two corrections on the same issue or after any auto-compaction.

## Hard rules (from docs/spec.md)

- Standard-mode model IDs only: `muse-spark-1.3`, `sam-3.1`, `muse-voice-transcribe-1.0`, `muse-image-1.0`, and `muse-wonder-1.0` once ATT-122 confirms it. Startup fails on anything else.
- No mocked providers on the production path. A step completes only with evidence from the current session.
- Fixtures are test inputs only; nothing on the deployed path reads `fixtures/`.
- A period the system could not observe is a `GapEvent`. No event is ever fabricated, and nothing is inferred across a gap.
- Contracts live in `shared/contracts/` and follow `docs/contracts.md`; a change is a PR that updates every consumer in the same merge.
- Secrets live in wrangler secrets only, never in the repo. The repo is public; a full-history gitleaks scan gates every merge.
- Spend caps in code are the only hard stop on Meta spend.
- Any non-Meta component is named in the README.

## Branches and merges

- Trunk is `main`. Never commit to `main` and never merge; Thomas merges, in the 10:00 and 20:00 ET windows.
- All work is Thomas's; there are no separate seats. Branches are short-lived and named `thomas/att-<n>-<slug>` with the Linear id.
- `docs/ownership.md` lists the paths a branch may touch and maps them to workstream areas A to E; a path it doesn't list fails.
- CI (typecheck, lint, unit tests, gitleaks) gates every merge.
- Commit messages and PR bodies name the Linear id and carry no AI attribution (no Co-Authored-By trailer).
