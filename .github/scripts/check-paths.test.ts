import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPaths, isValidBranch, parseOwnershipTable, resolvePrefix } from "./check-paths.ts";
import { createTempRepo, type TempRepo } from "./temp-repo.ts";

const repoRoot = join(import.meta.dirname, "..", "..");
const ownership = readFileSync(join(repoRoot, "docs", "ownership.md"), "utf8");
const script = join(import.meta.dirname, "check-paths.ts");

// Branch samples are assembled at runtime so that no file holds an issue-key-shaped name.
const branchName = (owner: string, ...rest: string[]): string => [owner, "/at", "t-", ...rest].join("");
const validBranch = branchName("thomas", "123", "-example");
const otherOwnerBranch = branchName("someone", "123", "-example");

describe("parseOwnershipTable", () => {
  it("reads every prefix from the ownership table", () => {
    const prefixes = parseOwnershipTable(ownership);
    expect(prefixes).toContain("worker/");
    expect(prefixes).toContain("worker/perception/");
    expect(prefixes).toContain("docs/spec.md");
    expect(prefixes).toContain(".github/");
  });

  it("rejects a document without the table header", () => {
    const broken = ownership.replace("| Path prefix |", "| Prefix |");
    expect(() => parseOwnershipTable(broken)).toThrow(/header/);
  });

  it("rejects a table without its separator row", () => {
    const broken = ownership.replace("| --- | --- | --- |\n", "");
    expect(() => parseOwnershipTable(broken)).toThrow(/separator/);
  });

  it("rejects a row with a missing cell", () => {
    const broken = ownership.replace("| `web/` | D |", "| `web/` |");
    expect(() => parseOwnershipTable(broken)).toThrow(/cells/);
  });

  it("rejects a prefix that is not one backticked value", () => {
    const broken = ownership.replace("| `scripts/` |", "| scripts/ |");
    expect(() => parseOwnershipTable(broken)).toThrow(/backticked/);
  });

  it("rejects a prefix listed twice", () => {
    const broken = ownership.replace("| `tests/` |", "| `web/` |");
    expect(() => parseOwnershipTable(broken)).toThrow(/twice/);
  });
});

describe("resolvePrefix", () => {
  const prefixes = parseOwnershipTable(ownership);

  it("matches a listed path to its row", () => {
    expect(resolvePrefix("worker/src/index.ts", prefixes)).toBe("worker/");
  });

  it("prefers the longest matching prefix", () => {
    expect(resolvePrefix("worker/perception/x", prefixes)).toBe("worker/perception/");
    expect(resolvePrefix("docs/spec.md", prefixes)).toBe("docs/spec.md");
  });

  it("compares prefixes as plain strings", () => {
    expect(resolvePrefix("tsconfig.base.json", prefixes)).toBe("tsconfig");
    expect(resolvePrefix("workers/index.ts", prefixes)).toBeUndefined();
  });

  it("finds no row for an unlisted path", () => {
    expect(resolvePrefix("src/index.ts", prefixes)).toBeUndefined();
  });
});

describe("isValidBranch", () => {
  it("accepts a branch named for an issue and a slug", () => {
    expect(isValidBranch(validBranch)).toBe(true);
    expect(isValidBranch(branchName("thomas", "456", "-path-check"))).toBe(true);
  });

  it("rejects any other branch name", () => {
    expect(isValidBranch(otherOwnerBranch)).toBe(false);
    expect(isValidBranch("thomas/scaffold")).toBe(false);
    expect(isValidBranch(branchName("thomas", "123"))).toBe(false);
    expect(isValidBranch(branchName("thomas", "123", "-Example"))).toBe(false);
    expect(isValidBranch("main")).toBe(false);
  });
});

describe("checkPaths", () => {
  it("passes listed paths on a valid branch", () => {
    const problems = checkPaths({
      branch: validBranch,
      paths: ["worker/src/index.ts", "package.json", "docs/spec.md"],
      ownershipMarkdown: ownership,
    });
    expect(problems).toEqual([]);
  });

  it("reports an unlisted path", () => {
    const problems = checkPaths({
      branch: validBranch,
      paths: ["worker/src/index.ts", "src/index.ts"],
      ownershipMarkdown: ownership,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("src/index.ts");
  });

  it("reports a branch with the wrong name", () => {
    const problems = checkPaths({
      branch: otherOwnerBranch,
      paths: ["worker/src/index.ts"],
      ownershipMarkdown: ownership,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(otherOwnerBranch);
  });

  it("reports a broken ownership table", () => {
    const problems = checkPaths({
      branch: validBranch,
      paths: ["worker/src/index.ts"],
      ownershipMarkdown: ownership.replace("| --- | --- | --- |\n", ""),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/ownership table/);
  });
});

describe("check-paths command", () => {
  let repo: TempRepo | undefined;
  afterEach(() => {
    repo?.remove();
    repo = undefined;
  });

  function run(branch: string, files: Record<string, string>) {
    repo = createTempRepo();
    const base = repo.commit({ "docs/ownership.md": ownership }, "Add ownership map");
    const head = repo.commit(files, "Change files");
    return spawnSync(process.execPath, [script], {
      cwd: repo.dir,
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: base, HEAD_SHA: head, BRANCH_NAME: branch },
    });
  }

  it("exits 0 when every changed path is listed", () => {
    const result = run(validBranch, { "worker/src/index.ts": "x\n", "web/src/a b.ts": "y\n" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("exits 1 and names the path when a changed path is unlisted", () => {
    const result = run(validBranch, { "worker/src/index.ts": "x\n", "notes/todo.md": "y\n" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("notes/todo.md");
  });

  it("exits 1 on a branch with the wrong name", () => {
    const result = run(otherOwnerBranch, { "worker/src/index.ts": "x\n" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(otherOwnerBranch);
  });
});
