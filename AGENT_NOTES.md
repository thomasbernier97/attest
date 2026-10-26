# Agent notes

Session handoffs, newest first. Every unit adds one entry before it ends; read the newest entries before starting. What a unit needs from another issue or area goes here as "Needs from".

Entry format:

```
## <date> · ATT-<n><unit> · <owner> · <branch> @ <sha>

- Works on the deployed URL: …
- Stubbed behind a contract: …
- Needs from: …
- Evidence: …
- Next: …
```

## 2026-10-26 · repository scaffold and CI checks · thomas · thomas/att-13-scaffold @ 4ee247b (base; this entry ships in the branch's one commit)

- Works on the deployed URL: nothing; no app is deployed.
- Stubbed behind a contract: nothing. `worker/`, `web/` and `shared/` are empty workspace packages (package.json and tsconfig.json only); each adds a `"typecheck": "tsc --noEmit"` script when it gets source, and the root `pnpm typecheck` runs it.
- Needs from: Thomas: mark the CI jobs Typecheck, Lint, Unit tests, Changed paths, Wording and Secret scan as required checks on `main` (a GitHub setting, not changed here).
- Evidence: pnpm 10.34.9 through corepack on Node 24; TypeScript 6.0.3 because typescript-eslint does not support 7.x yet. The path and wording checks in `.github/scripts/` have 38 unit tests, written first and shown failing, and each check caught one mutation. gitleaks 8.30.1 (pinned by version and SHA-256) fails on a throwaway clone with one seeded fake key and passes on this branch. actionlint 1.7.12 reports no errors.
- Next: Thomas reviews and merges the PR. Later work adds packages' source and tests on this workspace; check scripts run directly with `node` (type stripping), no build step.

## 2026-10-26 · ATT-12b · thomas · thomas/att-12-kickoff-docs @ 8b13f22 (base; this entry ships in the branch's one commit)

- Works on the deployed URL: nothing yet; this unit commits documents only, and no app is deployed.
- Stubbed behind a contract: nothing.
- Needs from: ATT-13 (area A): CI that fails a path `docs/ownership.md` doesn't list and runs the full-history gitleaks scan as a merge gate. ATT-122 (area C): confirm `muse-wonder-1.0` in Meta's docs before it joins the allowlist in `docs/contracts.md` and the startup check.
- Evidence: `docs/spec.md` change log has "Oct 23 research corrections applied (ATT-118)" (line 344); `docs/contracts.md` is the Oct 24 Notion page with the Oct 26 amendments listed in its top note; `docs/agent-prompts.md` is the Linear document verbatim; reviewer findings, gitleaks result and commit SHA are in the PR.
- Next: Thomas reviews and merges the PR. Not done in this unit: the GitHub integration in Linear and the git automations (ATT-12 items 3 and 4).
