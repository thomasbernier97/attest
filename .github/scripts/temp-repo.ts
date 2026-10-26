import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runGit } from "./git.ts";

// A throwaway git repository for tests that exercise the checks against real git output.
export interface TempRepo {
  readonly dir: string;
  git(...args: string[]): string;
  commit(files: Readonly<Record<string, string>>, message: string): string;
  remove(): void;
}

export function createTempRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), "attest-check-"));
  const git = (...args: string[]): string => runGit(args, dir);
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  git("config", "commit.gpgsign", "false");
  return {
    dir,
    git,
    commit(files, message) {
      for (const [path, content] of Object.entries(files)) {
        const full = join(dir, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, content);
      }
      git("add", "--all");
      git("commit", "--quiet", "--allow-empty", "--message", message);
      return git("rev-parse", "HEAD").trim();
    },
    remove() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
