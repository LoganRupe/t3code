import { describe, expect, it } from "vite-plus/test";

import { resolveDiffPanelIsGitRepo, resolveDiffRepoTargets } from "./DiffPanel.logic";

describe("resolveDiffRepoTargets", () => {
  it("diffs each worktree of an isolated multi-repo run", () => {
    expect(
      resolveDiffRepoTargets({
        threadWorktrees: [
          { repoRoot: "/repos/workspace/api", worktreePath: "/worktrees/thread/api" },
          { repoRoot: "/repos/workspace/web", worktreePath: "/worktrees/thread/web" },
        ],
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
        repoRoots: ["/repos/workspace/api", "/repos/workspace/web"],
      }),
    ).toEqual([
      { repoRoot: "/repos/workspace/api", cwd: "/repos/workspace/api" },
      { repoRoot: "/repos/workspace/web", cwd: "/repos/workspace/web" },
    ]);
  });

  it("leaves single-repo threads to the panel's single-cwd diff", () => {
    expect(resolveDiffRepoTargets({ threadWorktrees: [], repoRoots: ["/repos/app"] })).toEqual([]);
    expect(resolveDiffRepoTargets({ threadWorktrees: [], repoRoots: undefined })).toEqual([]);
  });
});

describe("resolveDiffPanelIsGitRepo", () => {
  it("shows diffs for a multi-repo workspace whose anchor is not a repo", () => {
    expect(resolveDiffPanelIsGitRepo({ diffRepoTargetCount: 2, probedIsRepo: false })).toBe(true);
  });

  it("trusts the probe for a single-repo project", () => {
    expect(resolveDiffPanelIsGitRepo({ diffRepoTargetCount: 0, probedIsRepo: false })).toBe(false);
    expect(resolveDiffPanelIsGitRepo({ diffRepoTargetCount: 0, probedIsRepo: true })).toBe(true);
  });

  it("assumes a repo while the probe is in flight", () => {
    expect(resolveDiffPanelIsGitRepo({ diffRepoTargetCount: 0, probedIsRepo: undefined })).toBe(
      true,
    );
  });
});
