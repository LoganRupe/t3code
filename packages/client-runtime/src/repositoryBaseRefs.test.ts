import { describe, expect, it } from "vite-plus/test";

import {
  filterRepositories,
  folderHasOwnBranch,
  hasWorktreeRepository,
  repositoriesWithOwnBaseRef,
  repositoryBaseRefChoices,
  repositoryBaseRefsFor,
  withRepositoryBaseRef,
  worktreeRepositoriesFor,
  worktreeRepositoriesForSend,
} from "./repositoryBaseRefs.ts";

const ref = (
  name: string,
  flags: { remote?: boolean; current?: boolean; isDefault?: boolean },
) => ({
  name,
  ...(flags.remote ? { isRemote: true, remoteName: "origin" } : {}),
  current: flags.current ?? false,
  isDefault: flags.isDefault ?? false,
  worktreePath: null,
});

describe("repositoryBaseRefChoices", () => {
  it("lists local branches and names the local default", () => {
    expect(
      repositoryBaseRefChoices([
        ref("main", { isDefault: true }),
        ref("feature", { current: true }),
        ref("origin/main", { remote: true, isDefault: true }),
      ]),
    ).toEqual({ branchNames: ["main", "feature"], defaultName: "main" });
  });

  it("offers the default's origin copy when no local branch carries it", () => {
    expect(
      repositoryBaseRefChoices([
        ref("feature", { current: true }),
        ref("origin/main", { remote: true, isDefault: true }),
      ]),
    ).toEqual({ branchNames: ["origin/main", "feature"], defaultName: "origin/main" });
  });

  it("falls back to the checkout without a known default", () => {
    expect(repositoryBaseRefChoices([ref("work", { current: true })]).defaultName).toBe("work");
    expect(repositoryBaseRefChoices([]).defaultName).toBeNull();
  });
});

describe("repository base ref picks", () => {
  const repositories = [
    { relativePath: ".", name: "context", path: "/ws" },
    { relativePath: "api", name: "api", path: "/ws/api" },
    { relativePath: "../web", name: "web", path: "/web" },
  ];

  it("gives every repository but the folder's own a picker", () => {
    expect(repositoriesWithOwnBaseRef(repositories).map((repo) => repo.relativePath)).toEqual([
      "api",
      "../web",
    ]);
  });

  it("replaces and clears one repository's pick", () => {
    const picked = withRepositoryBaseRef(
      withRepositoryBaseRef([], "api", "release"),
      "../web",
      "next",
    );
    expect(withRepositoryBaseRef(picked, "api", "hotfix")).toEqual([
      { relativePath: "../web", baseRef: "next" },
      { relativePath: "api", baseRef: "hotfix" },
    ]);
    expect(withRepositoryBaseRef(picked, "api", null)).toEqual([
      { relativePath: "../web", baseRef: "next" },
    ]);
  });

  it("sends only picks for listed repositories, in listed order", () => {
    const picks = [
      { relativePath: "../web", baseRef: "next" },
      { relativePath: "gone", baseRef: "main" },
      { relativePath: "api", baseRef: "release" },
    ];
    expect(repositoryBaseRefsFor(picks, repositories)).toEqual([
      { relativePath: "api", baseRef: "release" },
      { relativePath: "../web", baseRef: "next" },
    ]);
  });
});

describe("folderHasOwnBranch", () => {
  it("is true for an ordinary checkout and a workspace folder that is a repository", () => {
    expect(folderHasOwnBranch([])).toBe(true);
    expect(folderHasOwnBranch([{ relativePath: "." }, { relativePath: "api" }])).toBe(true);
  });

  it("is false for a workspace folder that only holds repositories", () => {
    expect(folderHasOwnBranch([{ relativePath: "api" }, { relativePath: "../web" }])).toBe(false);
  });
});

describe("worktree repositories", () => {
  const workspace = (count: number, withRoot = false) => [
    ...(withRoot ? [{ relativePath: "." }] : []),
    ...Array.from({ length: count }, (_, index) => ({ relativePath: `repo-${index}` })),
  ];

  it("gives every repository a worktree in a small workspace and none in a large one", () => {
    expect(worktreeRepositoriesFor(undefined, workspace(2, true))).toEqual(["repo-0", "repo-1"]);
    expect(worktreeRepositoriesFor(undefined, workspace(70))).toEqual([]);
  });

  it("keeps only picks the workspace still lists", () => {
    expect(worktreeRepositoriesFor(["repo-1", "gone"], workspace(3))).toEqual(["repo-1"]);
  });

  it("sends nothing when every repository gets a worktree, so older servers behave the same", () => {
    expect(worktreeRepositoriesForSend(undefined, workspace(2))).toBeUndefined();
    expect(worktreeRepositoriesForSend(["repo-0"], workspace(2))).toEqual(["repo-0"]);
    expect(worktreeRepositoriesForSend(undefined, [])).toBeUndefined();
  });

  it("needs a pick only when the folder is no repository of its own", () => {
    expect(hasWorktreeRepository([], workspace(2))).toBe(false);
    expect(hasWorktreeRepository([], workspace(2, true))).toBe(true);
    expect(hasWorktreeRepository(undefined, workspace(70))).toBe(false);
    expect(hasWorktreeRepository(undefined, [])).toBe(true);
  });
});

describe("filterRepositories", () => {
  const repositories = [
    { relativePath: "services/billing", name: "billing" },
    { relativePath: "services/auth", name: "Auth API" },
  ];

  it("matches name or path, ignoring case and surrounding space", () => {
    expect(filterRepositories(repositories, " AUTH ")).toEqual([repositories[1]]);
    expect(filterRepositories(repositories, "services/bill")).toEqual([repositories[0]]);
    expect(filterRepositories(repositories, "")).toBe(repositories);
  });
});
