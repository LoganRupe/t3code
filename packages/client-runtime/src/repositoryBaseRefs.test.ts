import { describe, expect, it } from "vite-plus/test";

import {
  folderHasOwnBranch,
  repositoriesWithOwnBaseRef,
  repositoryBaseRefChoices,
  repositoryBaseRefsFor,
  withRepositoryBaseRef,
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
