import { describe, expect, it } from "vite-plus/test";

import {
  resolveNewTaskBranchWorktreePath,
  resolveNewTaskLocalWorkspaceSelection,
  resolveNewTaskWorkspaceSelection,
  resolveRepositoryBaseRefsLabel,
} from "./new-task-context-presentation";

describe("resolveNewTaskWorkspaceSelection", () => {
  const fallback = { mode: "worktree", branch: null, worktreePath: null } as const;

  it("falls back to the current checkout when a non-git project defaults to worktree", () => {
    expect(
      resolveNewTaskWorkspaceSelection({ selection: undefined, fallback, isGitRepo: false }),
    ).toEqual({ mode: "local", branch: null, worktreePath: null });
  });

  it.each(["local", "worktree"] as const)(
    "clears stale %s selections for non-git projects",
    (mode) => {
      expect(
        resolveNewTaskWorkspaceSelection({
          selection: {
            mode,
            branch: "main",
            worktreePath: "/old-worktree",
            startFromOrigin: true,
            pullRequestReference: "https://github.com/acme/repo/pull/123",
          },
          fallback,
          isGitRepo: false,
        }),
      ).toEqual({ mode: "local", branch: null, worktreePath: null });
    },
  );

  // regression: #21404 use current checkout for non-git projects
  it("preserves the selection and defaults for git projects", () => {
    const selection = { mode: "local", branch: "feature", worktreePath: "/worktree" } as const;
    expect(resolveNewTaskWorkspaceSelection({ selection, fallback, isGitRepo: true })).toBe(
      selection,
    );
    expect(
      resolveNewTaskWorkspaceSelection({ selection: undefined, fallback, isGitRepo: true }),
    ).toBe(fallback);
  });
});

describe("resolveNewTaskLocalWorkspaceSelection", () => {
  it("waits for refs instead of carrying a worktree base into Current checkout", () => {
    expect(
      resolveNewTaskLocalWorkspaceSelection({
        branches: [],
        projectCwd: "/repo",
      }),
    ).toEqual({
      branch: null,
      worktreePath: null,
      awaitsCurrentBranch: true,
    });
  });

  it("carries the worktree path when the current branch lives in another worktree", () => {
    expect(
      resolveNewTaskLocalWorkspaceSelection({
        branches: [
          { name: "feature/split", current: true, worktreePath: "/repo/.t3/worktrees/split" },
          { name: "main", current: false, worktreePath: "/repo" },
        ],
        projectCwd: "/repo",
      }),
    ).toEqual({
      branch: "feature/split",
      worktreePath: "/repo/.t3/worktrees/split",
      awaitsCurrentBranch: false,
    });
  });
});

describe("resolveNewTaskBranchWorktreePath", () => {
  it("does not reuse an existing worktree while creating a new one", () => {
    expect(
      resolveNewTaskBranchWorktreePath({
        workspaceMode: "worktree",
        projectCwd: "/repo",
        branchWorktreePath: "/repo/.t3/worktrees/feature",
      }),
    ).toBeNull();
  });
});

describe("resolveNewTaskBranchLabel", () => {
  it("identifies a deferred PR checkout independently of the origin default", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "fork/feature",
        startFromOrigin: true,
        workspaceMode: "worktree",
        pullRequestReference: "https://github.com/acme/repo/pull/123",
      }),
    ).toBe("From PR #123");
  });
  it("shows the checked-out branch without a base-ref prefix", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "feature/mobile",
        startFromOrigin: true,
        workspaceMode: "local",
      }),
    ).toBe("feature/mobile");
  });

  it("labels a local worktree base with From", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "main",
        startFromOrigin: false,
        workspaceMode: "worktree",
      }),
    ).toBe("From main");
  });

  it("labels a remote worktree base with a remote marker", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: "main",
        startFromOrigin: true,
        workspaceMode: "worktree",
      }),
    ).toBe("From main (remote)");
  });

  it("prompts when no branch is available", () => {
    expect(
      resolveNewTaskBranchLabel({
        branchName: null,
        startFromOrigin: true,
        workspaceMode: "worktree",
      }),
    ).toBe("Choose branch");
  });
});

describe("filterNewTaskBranches", () => {
  const branches = [
    { name: "main", isRemote: false },
    { name: "Feature/Login-Page", isRemote: false },
    { name: "origin/fix/remote-only", isRemote: true },
  ];
  const search = (query: string) =>
    filterNewTaskBranches(branches, query).map((branch) => branch.name);

  it("ignores case in both the query and the branch name", () => {
    expect(search("feature/login")).toEqual(["Feature/Login-Page"]);
    expect(search("MAIN")).toEqual(["main"]);
  });

  it("keeps remote-only branches searchable", () => {
    expect(search("remote-only")).toEqual(["origin/fix/remote-only"]);
  });

  it("matches a typed space against the dash a branch name uses", () => {
    expect(search("  login page ")).toEqual(["Feature/Login-Page"]);
  });
});

describe("resolveRepositoryBaseRefsLabel", () => {
  it("counts repositories, and how many get a worktree when not all do", () => {
    expect(
      resolveRepositoryBaseRefsLabel({ repositoryCount: 3, worktreeCount: 3, pickCount: 0 }),
    ).toBe("3 repos");
    expect(
      resolveRepositoryBaseRefsLabel({ repositoryCount: 3, worktreeCount: 1, pickCount: 1 }),
    ).toBe("1 of 3 repos, 1 picked");
    expect(
      resolveRepositoryBaseRefsLabel({ repositoryCount: 1, worktreeCount: 0, pickCount: 0 }),
    ).toBe("0 of 1 repo");
  });
});
