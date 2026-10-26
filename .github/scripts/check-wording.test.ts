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

describe("findTerms", () => {
  it.each(Object.entries(samples))("finds the %s sample", (_name, term) => {
    expect(findTerms(`Plain text then ${term}, then more.`)).toEqual([term]);
  });

  it("finds every term on a line", () => {
    expect(findTerms(`${samples.issueKey} and ${samples.labelD}`)).toEqual([samples.issueKey, samples.labelD]);
  });

  it("leaves plain descriptive wording alone", () => {
    const plain = [
      assemble("branch thomas/at", "t-123-example"),
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
  it("passes plain added lines and commit messages", () => {
    const problems = checkWording({
      addedLines: [{ path: "README.md", line: 1, text: "Attest supervises a procedure." }],
      commits: [{ sha: "abc1234", message: "Add repository scaffold" }],
    });
    expect(problems).toEqual([]);
  });

  it("reports a term in an added line with its location", () => {
    const problems = checkWording({
      addedLines: [{ path: "worker/src/index.ts", line: 7, text: `// see ${samples.issueKey}` }],
      commits: [],
    });
    expect(problems).toEqual([`worker/src/index.ts:7: ${samples.issueKey}`]);
  });

  it("reports a term in a commit message", () => {
    const problems = checkWording({
      addedLines: [],
      commits: [{ sha: "abc1234def", message: `Fix scaffold\n\nPart of ${samples.labelT}.` }],
    });
    expect(problems).toEqual([`commit abc1234def: ${samples.labelT}`]);
  });

  it("allows terms in docs/spec.md only", () => {
    const problems = checkWording({
      addedLines: [
        { path: "docs/spec.md", line: 3, text: samples.labelS },
        { path: "docs/contracts.md", line: 3, text: samples.labelS },
      ],
      commits: [],
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

  function run(files: Record<string, string>, message: string) {
    repo = createTempRepo();
    const base = repo.commit({ "README.md": `Old line with ${samples.labelCP}\n` }, `Base ${samples.labelD}`);
    const head = repo.commit(files, message);
    return spawnSync(process.execPath, [script], {
      cwd: repo.dir,
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: base, HEAD_SHA: head },
    });
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

  it("exits 0 on a term added to docs/spec.md", () => {
    const result = run({ "docs/spec.md": `${samples.labelT}\n` }, "Update spec");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
