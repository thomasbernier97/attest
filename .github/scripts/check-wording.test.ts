import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkWording, findTerms, parseAddedLines } from "./check-wording.ts";
import { createTempRepo, type TempRepo } from "./temp-repo.ts";

const script = join(import.meta.dirname, "check-wording.ts");

// Samples are assembled at runtime so that no file in the repository contains a blocked term.
const assemble = (...parts: string[]): string => parts.join("");
// One sample per pattern in check-wording.ts, named by the pattern's leading letters.
const samples = {
  issueKey: assemble("AT", "T-", "42"),
  labelT: assemble("Ti", "er 3"),
  labelS: assemble("Se", "at B"),
  labelCP: assemble("C", "P2"),
  labelD: assemble("Da", "y 1"),
  labelV: assemble("V", "1-4"),
};
const branch = assemble("thomas/at", "t-", "123-example");

describe("findTerms", () => {
  it.each(Object.entries(samples))("finds the %s sample", (_name, term) => {
    expect(findTerms(`Plain text then ${term}, then more.`)).toEqual([term]);
  });

  it("finds an issue key in lower case", () => {
    const lower = assemble("at", "t-", "7");
    expect(findTerms(`branch thomas/${lower}-example`)).toEqual([lower]);
  });

  it("finds every term on a line", () => {
    expect(findTerms(`${samples.issueKey} and ${samples.labelD}`)).toEqual([samples.issueKey, samples.labelD]);
  });

  it("leaves plain descriptive wording alone", () => {
    const plain = [
      assemble("Mat", "t-123"),
      assemble("Ti", "er without a digit"),
      assemble("Se", "at F"),
      "CPU load",
      "Day one, Today 1",
      "V8 engine, v1-4",
    ];
    for (const line of plain) expect(findTerms(line)).toEqual([]);
  });
});

describe("parseAddedLines", () => {
  let repo: TempRepo | undefined;
  afterEach(() => {
    repo?.remove();
    repo = undefined;
  });

  it("returns each added line with its path and line number", () => {
    repo = createTempRepo();
    const base = repo.commit({ "a.md": "one\ntwo\n", "gone.md": "x\n" }, "Base");
    repo.git("rm", "--quiet", "gone.md");
    const head = repo.commit(
      { "a.md": "one\n++ looks like a header\ntwo\n", "dir/b c.md": "first\nsecond" },
      "Head",
    );
    const diff = repo.git("diff", "--unified=0", "--no-color", "--no-ext-diff", "--no-renames", "--no-prefix", `${base}...${head}`);
    expect(parseAddedLines(diff)).toEqual([
      { path: "a.md", line: 2, text: "++ looks like a header" },
      { path: "dir/b c.md", line: 1, text: "first" },
      { path: "dir/b c.md", line: 2, text: "second" },
    ]);
  });
});

describe("checkWording", () => {
  const plainInput = {
    addedLines: [],
    addedPaths: [],
    commits: [],
    title: "Add repository scaffold",
    body: "",
    branch,
  };

  it("passes plain added lines, paths, commit messages and pull request text", () => {
    const problems = checkWording({
      addedLines: [{ path: "README.md", line: 1, text: "Attest supervises a procedure." }],
      addedPaths: ["README.md"],
      commits: [{ sha: "abc1234", message: "Add repository scaffold" }],
      title: "Add repository scaffold",
      body: "Sets up the workspace.",
      branch,
    });
    expect(problems).toEqual([]);
  });

  it("ignores the pull request's own branch name in commit messages only", () => {
    const problems = checkWording({
      ...plainInput,
      commits: [{ sha: "abc1234", message: `Merge branch 'main' into ${branch}\n\nSee ${samples.issueKey}.` }],
      title: `Update ${branch}`,
    });
    expect(problems).toEqual([`commit abc1234: ${samples.issueKey}`, `pull request title: ${findTerms(branch)[0] ?? ""}`]);
  });

  it("still reports another branch's name in a commit message", () => {
    const other = assemble("thomas/at", "t-", "456-other");
    const problems = checkWording({ ...plainInput, commits: [{ sha: "abc1234", message: `Merge branch '${other}'` }] });
    expect(problems).toEqual([`commit abc1234: ${findTerms(other)[0] ?? ""}`]);
  });

  it("reports a term in an added file path", () => {
    const path = `notes/${samples.labelCP}-plan.md`;
    const problems = checkWording({ ...plainInput, addedPaths: [path] });
    expect(problems).toEqual([`path ${path}: ${samples.labelCP}`]);
  });

  it("reports a term in the pull request title", () => {
    const problems = checkWording({ ...plainInput, title: `Scaffold for ${samples.labelD}` });
    expect(problems).toEqual([`pull request title: ${samples.labelD}`]);
  });

  it("reports a term in the pull request body", () => {
    const problems = checkWording({ ...plainInput, body: `Serves ${samples.labelV}.` });
    expect(problems).toEqual([`pull request body: ${samples.labelV}`]);
  });

  it("reports a term in an added line with its location", () => {
    const problems = checkWording({
      ...plainInput,
      addedLines: [{ path: "worker/src/index.ts", line: 7, text: `// see ${samples.issueKey}` }],
    });
    expect(problems).toEqual([`worker/src/index.ts:7: ${samples.issueKey}`]);
  });

  it("reports a term in a commit message", () => {
    const problems = checkWording({
      ...plainInput,
      commits: [{ sha: "abc1234def", message: `Fix scaffold\n\nPart of ${samples.labelT}.` }],
    });
    expect(problems).toEqual([`commit abc1234def: ${samples.labelT}`]);
  });

  it("allows terms in docs/spec.md only", () => {
    const problems = checkWording({
      ...plainInput,
      addedLines: [
        { path: "docs/spec.md", line: 3, text: samples.labelS },
        { path: "docs/contracts.md", line: 3, text: samples.labelS },
      ],
    });
    expect(problems).toEqual([`docs/contracts.md:3: ${samples.labelS}`]);
  });
});

describe("check-wording command", () => {
  let repo: TempRepo | undefined;
  afterEach(() => {
    repo?.remove();
    repo = undefined;
  });

  // undefined leaves the variable unset: spawnSync skips environment entries whose value is undefined.
  interface PullRequestText {
    PR_TITLE?: string | undefined;
    PR_BODY?: string | undefined;
    BRANCH_NAME?: string | undefined;
  }

  function spawnCheck(base: string, head: string, text: PullRequestText) {
    const env: NodeJS.ProcessEnv = { ...process.env, BASE_SHA: base, HEAD_SHA: head };
    delete env.PR_TITLE;
    delete env.PR_BODY;
    delete env.BRANCH_NAME;
    return spawnSync(process.execPath, [script], {
      cwd: repo?.dir,
      encoding: "utf8",
      env: { ...env, ...text },
    });
  }

  const plainText: PullRequestText = { PR_TITLE: "Add worker entry", PR_BODY: "", BRANCH_NAME: branch };

  function run(files: Record<string, string>, message: string, text: PullRequestText = plainText) {
    repo = createTempRepo();
    const base = repo.commit({ "README.md": `Old line with ${samples.labelCP}\n` }, `Base ${samples.labelD}`);
    const head = repo.commit(files, message);
    return spawnCheck(base, head, text);
  }

  it("exits 0 when the branch adds only plain wording", () => {
    const result = run({ "worker/src/index.ts": "export const name = 'attest';\n" }, "Add worker entry");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("exits 1 on a term in an added line", () => {
    const result = run({ "worker/src/index.ts": `// ${samples.labelV}\n` }, "Add worker entry");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`worker/src/index.ts:1: ${samples.labelV}`);
  });

  it("exits 1 on a term in a commit message", () => {
    const result = run({ "worker/src/index.ts": "x\n" }, `Add worker entry for ${samples.issueKey}`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(samples.issueKey);
  });

  it("exits 1 on a term in a file git would show as binary", () => {
    const result = run({ "worker/src/data.txt": `x\0y\n${samples.issueKey}\n` }, "Add data");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`worker/src/data.txt:2: ${samples.issueKey}`);
  });

  it("exits 1 on a term when attributes turn off diffs", () => {
    const result = run(
      { ".gitattributes": "* -diff\n", "worker/src/index.ts": `// ${samples.issueKey}\n` },
      "Add worker entry",
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`worker/src/index.ts:1: ${samples.issueKey}`);
  });

  it("exits 1 on an issue key in lower case", () => {
    const lower = assemble("at", "t-", "7");
    const result = run({ "worker/src/index.ts": `// ${lower}\n` }, "Add worker entry");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`worker/src/index.ts:1: ${lower}`);
  });

  it("exits 1 on a term in an added file name", () => {
    const path = `worker/${samples.labelCP}.ts`;
    const result = run({ [path]: "x\n" }, "Add worker entry");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`path ${path}: ${samples.labelCP}`);
  });

  it("exits 1 on a term in a renamed file name", () => {
    repo = createTempRepo();
    const base = repo.commit({ "worker/old.ts": "x\n" }, "Base");
    const path = `worker/${samples.labelT}.ts`;
    repo.git("mv", "worker/old.ts", path);
    const head = repo.commit({}, "Rename worker file");
    const result = spawnCheck(base, head, plainText);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`path ${path}: ${samples.labelT}`);
  });

  it("exits 1 on a term in the pull request title", () => {
    const result = run({ "worker/src/index.ts": "x\n" }, "Add worker entry", {
      ...plainText,
      PR_TITLE: `Add worker entry for ${samples.issueKey}`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`pull request title: ${samples.issueKey}`);
  });

  it("exits 1 on a term in the pull request body", () => {
    const result = run({ "worker/src/index.ts": "x\n" }, "Add worker entry", {
      ...plainText,
      PR_BODY: `Serves ${samples.labelV}.`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`pull request body: ${samples.labelV}`);
  });

  it("fails when the pull request title is not passed in", () => {
    const result = run({ "worker/src/index.ts": "x\n" }, "Add worker entry", { ...plainText, PR_TITLE: undefined });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PR_TITLE is not set");
  });

  it("fails when the pull request body is not passed in", () => {
    const result = run({ "worker/src/index.ts": "x\n" }, "Add worker entry", { ...plainText, PR_BODY: undefined });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PR_BODY is not set");
  });

  it("fails when the branch name is not passed in", () => {
    const result = run({ "worker/src/index.ts": "x\n" }, "Add worker entry", { ...plainText, BRANCH_NAME: undefined });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BRANCH_NAME is not set");
  });

  it("exits 0 on the default merge commit that brings the branch up to date", () => {
    repo = createTempRepo();
    const base = repo.commit({ "README.md": "Old line\n" }, "Base");
    repo.git("switch", "--quiet", "--create", branch);
    repo.commit({ "worker/src/index.ts": "x\n" }, "Add worker entry");
    repo.git("switch", "--quiet", "main");
    const newBase = repo.commit({ "web/src/index.ts": "y\n" }, "Add web entry");
    repo.git("switch", "--quiet", branch);
    repo.git("merge", "--quiet", "--no-edit", "--message", `Merge branch 'main' into ${branch}`, "main");
    const head = repo.git("rev-parse", "HEAD").trim();
    expect(repo.git("log", "-1", "--format=%P", head).trim().split(" ")).toHaveLength(2);
    for (const baseSha of [base, newBase]) {
      const result = spawnCheck(baseSha, head, plainText);
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    }
  });

  it("exits 0 on a term added to docs/spec.md", () => {
    const result = run({ "docs/spec.md": `${samples.labelT}\n` }, "Update spec");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
