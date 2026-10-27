# Agent notes

Session handoffs, newest first. Every unit adds one entry before it ends; read the newest entries before starting. What a unit needs from another issue or area goes here as "Needs from".

Entry format:

```
## <date> · <what the unit did, in plain words> · <base sha>

- Works on the deployed URL: …
- Stubbed behind a contract: …
- Needs from: …
- Evidence: …
- Next: …
```

## 2026-10-26 · procedure reader: demo procedure text to a ProcedureDraft with Muse Spark · fc46bc4

- Works on the deployed URL: nothing; no app is deployed.
- Stubbed behind a contract: nothing. `worker/procedure/compile.ts` sends the procedure text to muse-spark-1.3 (reasoning effort high, json_schema from the shared `ProcedureDraft`) and validates the reply with `ProcedureDraft.safeParse`, whose refinements carry the contract's cross-checks; a reply that fails is rejected with its body, never repaired. It reuses `outputText` and `SparkReplyError` from `worker/perception/spark.ts` (now exported). `scripts/compile-procedure.ts` runs it once (usage in its header comment). The approved demo procedure is `docs/demo-procedure.md`; the spec's demo script and storyboard follow it.
- Decisions in the compile prompt (for Thomas to confirm): a hazard `condition` is the safe state, satisfied when it holds and violated when it does not, checkable in any segment, because the observe prompt never shows Spark `before_step`; the state machine applies the rule before its step. Objects are only what a cue or a condition needs the camera to find; screws and the fan cable are judged on what they attach to. Worn, held, switched or lit is `object_state`.
- Findings: one request; 8 steps, 8 objects, 2 hazard rules, every check passed on the first draft. Spark also set step 4 to depend on 2 and 3, step 6 on 5, step 7 on 6, step 8 on 3. Prompts: "gloves", "case fan", "tape square", "screwdriver", "tool tray", "metal bracket", "USB fan controller", "power strip". 42.1 s, 1,004 tokens in, 11,385 out (10,493 reasoning), $0.0496.
- Open questions for Thomas: whether step 6 should depend on step 5 (the cable can be connected with the fan lying down); 8 tracked objects cost more SAM frames per segment than the 6 the cost model assumed; the demo kit list in `docs/spec.md` does not yet name the power strip, tool tray or tape.
- Evidence: typecheck and lint exit 0; a fresh-context review found no bug or key path, and its hazard-condition, object-scope and worn-state findings went into the prompt before the run. The draft parses under the shared schema. No tests added, by Thomas's call.
- Next: the approval flow that mints ids and stores a `Procedure`; a SAM run on the new prompts, "metal bracket" first.

## 2026-10-26 · first real clip through the Files API, SAM and Muse Spark · 5a583f9

- Works on the deployed URL: nothing; no app is deployed.
- Stubbed behind a contract: nothing. `worker/meta/files.ts` uploads with a 7-day expiry; `worker/perception/sam.ts` sends one sam-3.1 request per object label in parallel and parses the stream into `Tracks`; `worker/perception/spark.ts` asks muse-spark-1.3 for an `Observation` under a JSON Schema built per procedure and validates the reply. All three use fetch and Web APIs only (`worker/tsconfig.json` has the webworker lib and no Node types). `worker/meta/api.ts` counts requests and refuses any past the budget it is given. `scripts/first-clip.ts` runs them on one clip (usage in its header comment).
- Decisions (Thomas, Oct 26): `fps` is a positive number in Session, Tracks and Recording; a tracked object's `confidence` is null when no frame has a box; MeasurementTable rates are null with nothing to measure. Meta's docs pages not reachable through Context7 (quota spent) were read on dev.meta.ai directly. The clip was recorded as a 5 s take with the first second dropped.
- Findings: the numbers, the SAM and Spark request shapes and the proposals (4 s, 12.5 fps, Spark effort minimal) are in the first-clip entry under the measurements open question in `docs/spec.md`. SAM's `c` is one value per track, repeated on every frame; SAM only returns it with `metadata.include_confidence: "true"`. SAM requests time out, and a stream that does not end in a completed response fails; one failed label fails the whole segment's tracks rather than returning partial tracks. Spark cached no tokens on an identical second call without `prompt_cache_key`.
- Open questions for Thomas: Tracks has no instance id, so several matches in one frame (SAM allows up to 16) become several boxes with the same `t_ms`, and `confidence` is a mean over matches rather than over frames; no frame on this clip had more than one match.
- Evidence: typecheck, lint and the existing tests exit 0. A fresh-context review found no key path, no Node API in `worker/` and no un-updated consumer; its stream, timeout, frame-count and saved-error findings are fixed. 9 Meta requests. Both runs' Tracks and Observation parse under the shared schemas. No tests added, by Thomas's call.
- Next: a more specific bracket prompt (it was found only in the last 15 frames), `prompt_cache_key` for Spark, latency on browser-made segments, and masks to R2 (`mask_key` is null for now).

## 2026-10-26 · shared contracts package · 29db5ae

- Works on the deployed URL: nothing; no app is deployed.
- Stubbed behind a contract: nothing. `shared/contracts/` has every schema in `docs/contracts.md` as Zod 4 with exported types and one version constant per contract; `shared/pricing.ts` holds the Oct 23 prices in micro-USD. Import from `@attest/shared` and `@attest/shared/pricing`.
- Decisions (Thomas, Oct 26): server messages that carry an event or utterance put it under a key named after the message type (`{ v, type: "step_event", server_at, step_event }`); `closed.reason` is never null; `fps` stays an integer as `docs/contracts.md` says, although the spec runs capture at 12.5 fps for now. `language` has no default value (structured output requires every field). `MeasurementTable.runs` does not enforce 12 entries.
- Open questions for Thomas: a catch rate with nothing to catch (0 of 0) and a tracked object's mean confidence with no boxes have no valid value, because those fields are plain numbers; hazard `message` is capped at 20 words (the field rule), while the conventions table says 40. The code follows the field rule. Hazard evidence `moment_ms` is bounded to the segment like step evidence, following the validator rules.
- Evidence: typecheck and lint exit 0. A throwaway script outside the repo parsed valid and invalid samples and checked that the JSON Schema for ProcedureDraft and Observation meets the strict structured-output rules (no problems, depth at most 10). No tests added, by Thomas's call.
- Next: Thomas reviews and merges the PR. Worker and web code build against these types; the structured-output schema check in CI is still to do.

## 2026-10-26 · repository scaffold and CI checks · 4ee247b

- Works on the deployed URL: nothing; no app is deployed.
- Stubbed behind a contract: nothing. `worker/`, `web/` and `shared/` are empty workspace packages (package.json and tsconfig.json only); each adds a `"typecheck": "tsc --noEmit"` script when it gets source, and the root `pnpm typecheck` runs it.
- Needs from: Thomas: mark the CI jobs Typecheck, Lint, Unit tests, Changed paths, Wording and Secret scan as required checks on `main` (a GitHub setting, not changed here).
- Evidence: built on `main` at 4ee247b. pnpm 10.34.9 through corepack on Node 24; TypeScript 6.0.3 because typescript-eslint does not support 7.x yet. The path and wording checks in `.github/scripts/` have 54 unit tests, written first and shown failing, and each check caught one mutation. gitleaks 8.30.1 (pinned by version and SHA-256) fails on a throwaway clone with one seeded fake key and passes on this branch. actionlint 1.7.12 reports no errors.
- Evidence, second commit (hardened checks): the path check reads `docs/ownership.md` from the base branch, so a pull request cannot add the row for its own new path; a test for exactly that failed before the change and fails again when the check reads the map from the head. The wording check matches issue keys in any case and also scans added and renamed file names and the pull request title and body, which the workflow passes in as environment variables and rechecks when the pull request is edited. The pull request's own branch name is ignored in commit messages only, so the default merge commit that brings a branch up to date still passes; the new tests failed first, and dropping the case flag or the file name scan each made tests fail. The secret scan now ignores `gitleaks:allow` comments, reads every file as text so a `.gitattributes` in any directory cannot hide one, and a step before it fails if `.gitleaks.toml` or `.gitleaksignore` is in the repository: on throwaway clones a fake key marked `gitleaks:allow` fails the scan, so does a fake key under a `* -diff` attribute, a `.gitleaks.toml` fails the new step, and this branch passes both. `engines` asks for Node 24.2 or later because the check scripts use `import.meta.main`; the unused `globals` dependency is removed; Vitest also runs `.test.tsx` files.
- Next: Thomas reviews and merges the PR. Later work adds packages' source and tests on this workspace; check scripts run directly with `node` (type stripping), no build step.

## 2026-10-26 · kickoff documents · 8b13f22 (base; this entry ships in the branch's one commit)

- Works on the deployed URL: nothing yet; this unit commits documents only, and no app is deployed.
- Stubbed behind a contract: nothing.
- Needs from: area A: CI that fails a path `docs/ownership.md` doesn't list and runs the full-history gitleaks scan as a merge gate. Area C: confirm `muse-wonder-1.0` in Meta's docs before it joins the allowlist in `docs/contracts.md` and the startup check.
- Evidence: `docs/spec.md` change log has the Oct 23 research corrections entry (line 344); `docs/contracts.md` is the Oct 24 Notion page with the Oct 26 amendments listed in its top note; `docs/agent-prompts.md` is the Linear document verbatim; reviewer findings, gitleaks result and commit SHA are in the PR.
- Next: Thomas reviews and merges the PR. Not done in this unit: the GitHub integration in Linear and the git automations (items 3 and 4 of the kickoff issue).
