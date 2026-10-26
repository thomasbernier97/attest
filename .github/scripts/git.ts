import { execFileSync } from "node:child_process";

// Runs git with settings that keep its output stable whatever the local git config says.
export function runGit(args: readonly string[], cwd: string): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}
