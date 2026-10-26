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

## 2026-10-26 · ATT-12b · thomas · thomas/att-12-kickoff-docs @ 8b13f22 (base; this entry ships in the branch's one commit)

- Works on the deployed URL: nothing yet; this unit commits documents only, and no app is deployed.
- Stubbed behind a contract: nothing.
- Needs from: ATT-13 (area A): CI that fails a path `docs/ownership.md` doesn't list and runs the full-history gitleaks scan as a merge gate. ATT-122 (area C): confirm `muse-wonder-1.0` in Meta's docs before it joins the allowlist in `docs/contracts.md` and the startup check.
- Evidence: `docs/spec.md` change log has "Oct 23 research corrections applied (ATT-118)" (line 344); `docs/contracts.md` is the Oct 24 Notion page with the Oct 26 amendments listed in its top note; `docs/agent-prompts.md` is the Linear document verbatim; reviewer findings, gitleaks result and commit SHA are in the PR.
- Next: Thomas reviews and merges the PR. Not done in this unit: the GitHub integration in Linear and the git automations (ATT-12 items 3 and 4).
