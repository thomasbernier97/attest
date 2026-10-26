# Ownership

All work is done by Thomas, through agent sessions on `thomas/att-<n>-<slug>` branches; there are no separate seats. The Area letters are the workstream areas in docs/spec.md (Workstreams per seat), kept so issues, labels and spec sections map to directories: A platform and session core, B perception, C procedure and voice, D front end, E quality and release. `—` marks project-wide files.

Rules:

- A path's area is the row with the longest path prefix the path starts with, compared as plain strings (no globs). `docs/spec.md` is project-wide although `docs/` is area E.
- A branch may touch any listed path.
- A path that matches no row fails on every branch; CI (ATT-13) enforces this.

| Path prefix | Area | What |
| --- | --- | --- |
| `worker/` | A | Hono app, Session DO, D1 schema and migrations, R2, auth, Turnstile, rate limits, deploy |
| `worker/perception/` | B | SAM client, Spark observe client, validators, state machine, prompts, measurement scorer |
| `worker/procedure/` | C | Procedure compiler, approval, Muse Image references |
| `worker/voice/` | C | ASR socket, intents, answer-worker |
| `web/` | D | Worker view, supervisor timeline, replay player, capture pipeline, audio worklet |
| `shared/` | A | Contracts package (`shared/contracts/`), price table |
| `tests/` | E | Unit, contract and Playwright tests |
| `scripts/` | E | Measurement and release scripts |
| `fixtures/` | E | Recorded real responses; test inputs only |
| `docs/` | E | Documentation other than the four documents below |
| `docs/spec.md` | — | Canonical spec |
| `docs/contracts.md` | — | Field-level contract specification |
| `docs/agent-prompts.md` | — | How to write a Flo agent prompt |
| `docs/ownership.md` | — | This map |
| `.github/` | A | CI workflows |
| `package.json` | A | Workspace manifest |
| `pnpm-lock.yaml` | A | Lockfile |
| `pnpm-workspace.yaml` | A | Workspace definition |
| `tsconfig` | A | TypeScript config |
| `eslint.config` | A | Lint config |
| `vitest.config` | A | Test runner config |
| `wrangler` | A | Cloudflare Worker config |
| `.gitignore` | A | Ignored paths |
| `.nvmrc` | A | Node version |
| `.npmrc` | A | Package manager config |
| `README.md` | E | Submission README |
| `AGENT_NOTES.md` | — | Session handoffs |
| `CLAUDE.md` | — | Agent protocol |
| `LICENSE` | — | Apache-2.0 licence |
