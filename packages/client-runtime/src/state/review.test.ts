import { describe, expect, it } from "vite-plus/test";

import { resolveDiffRepoTargets } from "./review.ts";

describe("resolveDiffRepoTargets", () => {
  it("diffs each worktree of an isolated multi-repo run", () => {
    expect(
      resolveDiffRepoTargets({
        threadWorktrees: [
          { repoRoot: "/repos/workspace/api", worktreePath: "/worktrees/thread/api" },
          { repoRoot: "/repos/workspace/web", worktreePath: "/worktrees/thread/web" },
        ],
        threadWorktreePath: "/worktrees/thread/api",
        repoRoots: ["/repos/workspace/api", "/repos/workspace/web"],
      }),
    ).toEqual([
      { repoRoot: "/repos/workspace/api", cwd: "/worktrees/thread/api" },
      { repoRoot: "/repos/workspace/web", cwd: "/worktrees/thread/web" },
    ]);
  });

  it("ignores worktree entries that have no path yet", () => {
    expect(
      resolveDiffRepoTargets({
        threadWorktrees: [{ repoRoot: "/repos/workspace/api", worktreePath: "" }],
        threadWorktreePath: null,
        repoRoots: ["/repos/workspace/api", "/repos/workspace/web"],
      }),
    ).toEqual([
      { repoRoot: "/repos/workspace/api", cwd: "/repos/workspace/api" },
      { repoRoot: "/repos/workspace/web", cwd: "/repos/workspace/web" },
    ]);
  });

  it("diffs each repo root of a non-isolated workspace-file project", () => {
    expect(
      resolveDiffRepoTargets({
        threadWorktrees: [],
        threadWorktreePath: null,
        repoRoots: ["/repos/workspace/api", "/repos/workspace/web"],
      }),
    ).toEqual([
      { repoRoot: "/repos/workspace/api", cwd: "/repos/workspace/api" },
      { repoRoot: "/repos/workspace/web", cwd: "/repos/workspace/web" },
    ]);
  });

  it("never diffs the project checkouts for an isolated thread without a worktree map", () => {
    expect(
      resolveDiffRepoTargets({
        threadWorktrees: [],
        threadWorktreePath: "/worktrees/thread/api",
        repoRoots: ["/repos/workspace/api", "/repos/workspace/web"],
      }),
    ).toEqual([]);
  });

  it("leaves single-repo threads to the single-cwd diff", () => {
    expect(
      resolveDiffRepoTargets({
        threadWorktrees: [],
        threadWorktreePath: null,
        repoRoots: ["/repos/app"],
      }),
    ).toEqual([]);
    expect(
      resolveDiffRepoTargets({
        threadWorktrees: [],
        threadWorktreePath: null,
        repoRoots: undefined,
      }),
    ).toEqual([]);
  });
});
