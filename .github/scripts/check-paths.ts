// Fails a pull request whose branch is misnamed or that changes a path docs/ownership.md on the base branch does not list.
// Usage: BASE_SHA=<sha> HEAD_SHA=<sha> BRANCH_NAME=<name> node .github/scripts/check-paths.ts
import { runGit } from "./git.ts";

const OWNERSHIP_FILE = "docs/ownership.md";
const BRANCH_PATTERN = /^thomas\/att-\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEPARATOR_CELL = /^:?-{3,}:?$/;
const PREFIX_CELL = /^`([^`]+)`$/;

function splitRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 2) return undefined;
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

// Returns the path prefixes from the first table whose header starts with "Path prefix".
export function parseOwnershipTable(markdown: string): string[] {
  const lines = markdown.split("\n");
  const headerIndex = lines.findIndex((line) => splitRow(line)?.[0] === "Path prefix");
  if (headerIndex === -1) throw new Error("header row starting with 'Path prefix' not found");
  const columns = splitRow(lines[headerIndex] ?? "")?.length ?? 0;

  const separator = splitRow(lines[headerIndex + 1] ?? "");
  if (separator?.length !== columns || !separator.every((cell) => SEPARATOR_CELL.test(cell))) {
    throw new Error(`line ${String(headerIndex + 2)}: separator row expected after the header`);
  }

  const prefixes: string[] = [];
  for (let index = headerIndex + 2; index < lines.length; index++) {
    const cells = splitRow(lines[index] ?? "");
    if (cells === undefined) break;
    const lineNumber = String(index + 1);
    if (cells.length !== columns) {
      throw new Error(`line ${lineNumber}: expected ${String(columns)} cells, found ${String(cells.length)}`);
    }
    const prefix = PREFIX_CELL.exec(cells[0] ?? "")?.[1];
    if (prefix === undefined) throw new Error(`line ${lineNumber}: path prefix must be one backticked value`);
    if (prefixes.includes(prefix)) throw new Error(`line ${lineNumber}: prefix ${prefix} is listed twice`);
    prefixes.push(prefix);
  }
  if (prefixes.length === 0) throw new Error("the table has no rows");
  return prefixes;
}

// The row for a path is the longest prefix the path starts with, compared as plain strings.
export function resolvePrefix(path: string, prefixes: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const prefix of prefixes) {
    if (path.startsWith(prefix) && (best === undefined || prefix.length > best.length)) best = prefix;
  }
  return best;
}

export function isValidBranch(name: string): boolean {
  return BRANCH_PATTERN.test(name);
}

export interface PathCheckInput {
  branch: string;
  paths: readonly string[];
  ownershipMarkdown: string;
}

export function checkPaths({ branch, paths, ownershipMarkdown }: PathCheckInput): string[] {
  const problems: string[] = [];
  if (!isValidBranch(branch)) {
    problems.push(`branch ${branch} does not match thomas/att-<number>-<slug>`);
  }
  let prefixes: string[];
  try {
    prefixes = parseOwnershipTable(ownershipMarkdown);
  } catch (error) {
    problems.push(`${OWNERSHIP_FILE}: broken ownership table: ${(error as Error).message}`);
    return problems;
  }
  for (const path of paths) {
    if (resolvePrefix(path, prefixes) === undefined) {
      problems.push(`${path}: no row in ${OWNERSHIP_FILE} lists this path`);
    }
  }
  return problems;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function main(): number {
  const base = requireEnv("BASE_SHA");
  const head = requireEnv("HEAD_SHA");
  const branch = requireEnv("BRANCH_NAME");
  const cwd = process.cwd();
  const paths = runGit(["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`], cwd)
    .split("\0")
    .filter((path) => path !== "");
  // The map comes from the base branch, so a pull request cannot list the paths it adds.
  const ownershipMarkdown = runGit(["show", `${base}:${OWNERSHIP_FILE}`], cwd);

  const problems = checkPaths({ branch, paths, ownershipMarkdown });
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) return 1;
  console.log(`${String(paths.length)} changed paths are listed in ${OWNERSHIP_FILE}; branch name is valid.`);
  return 0;
}

if (import.meta.main) process.exitCode = main();
