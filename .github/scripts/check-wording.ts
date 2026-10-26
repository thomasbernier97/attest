// Fails a pull request whose added lines, added file paths, commit messages, title or body use
// internal planning labels. The repository is read by people who do not know the plan, so code,
// history and pull requests use plain words.
// Usage: BASE_SHA=<sha> HEAD_SHA=<sha> PR_TITLE=<title> PR_BODY=<body> BRANCH_NAME=<name> node .github/scripts/check-wording.ts
import { runGit } from "./git.ts";

// docs/spec.md is the planning document itself, so its labels are allowed there.
const EXEMPT_PATHS: ReadonlySet<string> = new Set(["docs/spec.md"]);

const TERM_PATTERNS: readonly RegExp[] = [
  /\bATT-\d+/gi,
  /\bTier \d/g,
  /\bSeat [A-E]\b/g,
  /\bCP\d/g,
  /\bDay \d/g,
  /\bV\d+-\d+/g,
];

export function findTerms(text: string): string[] {
  const found: { index: number; term: string }[] = [];
  for (const pattern of TERM_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.push({ index: match.index, term: match[0] });
  }
  return found.sort((a, b) => a.index - b.index).map(({ term }) => term);
}

export interface AddedLine {
  path: string;
  line: number;
  text: string;
}

export interface Commit {
  sha: string;
  message: string;
}

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const C_ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

// Reads a path from a "+++" header: git appends a tab to names with spaces and C-quotes unusual names.
function parseHeaderPath(raw: string): string {
  const name = raw.endsWith("\t") ? raw.slice(0, -1) : raw;
  if (!name.startsWith('"')) return name;
  const bytes: number[] = [];
  for (let index = 1; index < name.length - 1; index++) {
    const char = name.charAt(index);
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const next = name.charAt(index + 1);
    const octal = /^[0-7]{3}/.exec(name.slice(index + 1))?.[0];
    if (octal !== undefined) {
      bytes.push(parseInt(octal, 8));
      index += 3;
    } else {
      bytes.push(C_ESCAPES[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

// Parses `git diff --unified=0 --no-prefix` output. Hunk line counts decide which lines are
// content, so an added line that itself starts with "++" is never mistaken for a file header.
export function parseAddedLines(diff: string): AddedLine[] {
  const added: AddedLine[] = [];
  let path: string | undefined;
  let oldRemaining = 0;
  let newRemaining = 0;
  let newLine = 0;
  for (const line of diff.split("\n")) {
    if (oldRemaining > 0 || newRemaining > 0) {
      if (line.startsWith("+")) {
        if (path !== undefined) added.push({ path, line: newLine, text: line.slice(1) });
        newLine++;
        newRemaining--;
      } else if (line.startsWith("-")) {
        oldRemaining--;
      } else if (!line.startsWith("\\")) {
        throw new Error(`unexpected line inside a hunk: ${line}`);
      }
      continue;
    }
    if (line.startsWith("diff --git ")) {
      path = undefined;
    } else if (line.startsWith("+++ ")) {
      const raw = line.slice(4);
      path = raw === "/dev/null" ? undefined : parseHeaderPath(raw);
    } else if (line.startsWith("@@ ")) {
      const match = HUNK_HEADER.exec(line);
      if (match === null) throw new Error(`unreadable hunk header: ${line}`);
      oldRemaining = Number(match[1] ?? "1");
      newLine = Number(match[2]);
      newRemaining = Number(match[3] ?? "1");
    }
  }
  return added;
}

export interface WordingCheckInput {
  addedLines: readonly AddedLine[];
  // Paths of files the branch adds; a renamed file counts as added under its new name.
  addedPaths: readonly string[];
  commits: readonly Commit[];
  title: string;
  body: string;
  // The pull request's own branch name, which git writes into merge commits; the path check validates it.
  branch: string;
}

export function checkWording({ addedLines, addedPaths, commits, title, body, branch }: WordingCheckInput): string[] {
  const problems: string[] = [];
  for (const { path, line, text } of addedLines) {
    if (EXEMPT_PATHS.has(path)) continue;
    for (const term of findTerms(text)) problems.push(`${path}:${String(line)}: ${term}`);
  }
  for (const path of addedPaths) {
    for (const term of findTerms(path)) problems.push(`path ${path}: ${term}`);
  }
  for (const { sha, message } of commits) {
    for (const term of findTerms(message.replaceAll(branch, " "))) problems.push(`commit ${sha}: ${term}`);
  }
  for (const term of findTerms(title)) problems.push(`pull request title: ${term}`);
  for (const term of findTerms(body)) problems.push(`pull request body: ${term}`);
  return problems;
}

function requireEnv(name: string, { allowEmpty = false } = {}): string {
  const value = process.env[name];
  if (value === undefined || (value === "" && !allowEmpty)) throw new Error(`${name} is not set`);
  return value;
}

function main(): number {
  const base = requireEnv("BASE_SHA");
  const head = requireEnv("HEAD_SHA");
  // The workflow passes the event's title and body as environment variables; a body may be empty.
  const title = requireEnv("PR_TITLE");
  const body = requireEnv("PR_BODY", { allowEmpty: true });
  const branch = requireEnv("BRANCH_NAME");
  const cwd = process.cwd();
  // --text scans files git would otherwise skip as binary, including those marked -diff in .gitattributes.
  const diff = runGit(
    [
      "diff",
      "--unified=0",
      "--text",
      "--no-textconv",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      "--no-prefix",
      `${base}...${head}`,
    ],
    cwd,
  );
  // --no-renames lists a renamed file as added under its new name.
  const addedPaths = runGit(
    ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=A", `${base}...${head}`],
    cwd,
  )
    .split("\0")
    .filter((path) => path !== "");
  const commits = runGit(["log", "-z", "--format=%H%n%B", `${base}..${head}`], cwd)
    .split("\0")
    .filter((record) => record !== "")
    .map((record) => {
      const newline = record.indexOf("\n");
      return { sha: record.slice(0, newline), message: record.slice(newline + 1) };
    });

  const addedLines = parseAddedLines(diff);
  const problems = checkWording({ addedLines, addedPaths, commits, title, body, branch });
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error("Use plain descriptive words instead of planning labels (docs/spec.md is exempt).");
    return 1;
  }
  console.log(
    `${String(addedLines.length)} added lines, ${String(addedPaths.length)} added paths, ` +
      `${String(commits.length)} commit messages and the pull request title and body use plain wording.`,
  );
  return 0;
}

if (import.meta.main) process.exitCode = main();
