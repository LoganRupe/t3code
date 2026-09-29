import { describe, expect, it } from "vite-plus/test";

import { resolveProjectFileRoots } from "./projectFileRoots";

const folder = (absolutePath: string, exists = true) => ({ absolutePath, exists });

describe("resolveProjectFileRoots", () => {
  it("spans every listed folder of a workspace file, git or not", () => {
    expect(
      resolveProjectFileRoots({
        workspaceFolders: [folder("/ws/api"), folder("/ws/web"), folder("/ws/docs")],
        repoRoots: ["/ws/api", "/ws/web"],
        worktrees: [],
      }),
    ).toEqual(["/ws/api", "/ws/web", "/ws/docs"]);
  });

  it("spans a one-repo workspace's listed folders instead of the workspace folder", () => {
    expect(
      resolveProjectFileRoots({
        workspaceFolders: [folder("/ws/api"), folder("/ws/docs")],
        repoRoots: ["/ws/api"],
        worktrees: [],
      }),
    ).toEqual(["/ws/api", "/ws/docs"]);
  });

  it("leaves out listed folders missing from disk", () => {
    expect(
      resolveProjectFileRoots({
        workspaceFolders: [folder("/ws/api"), folder("/ws/gone", false), folder("/ws/docs")],
        repoRoots: ["/ws/api"],
        worktrees: [],
      }),
    ).toEqual(["/ws/api", "/ws/docs"]);
  });

  it("falls back to multi-repo roots until the workspace file is read", () => {
    expect(
      resolveProjectFileRoots({
        workspaceFolders: null,
        repoRoots: ["/ws/api", "/ws/web"],
        worktrees: [],
      }),
    ).toEqual(["/ws/api", "/ws/web"]);
    expect(
      resolveProjectFileRoots({ workspaceFolders: null, repoRoots: ["/ws/api"], worktrees: [] }),
    ).toBeNull();
  });

  it("uses the single cwd when fewer than two folders remain", () => {
    expect(
      resolveProjectFileRoots({
        workspaceFolders: [folder("/ws/api"), folder("/ws/gone", false)],
        repoRoots: ["/ws/api"],
        worktrees: [],
      }),
    ).toBeNull();
  });

  it("swaps a repo an isolated run covers for its worktree", () => {
    expect(
      resolveProjectFileRoots({
        workspaceFolders: [folder("/ws/api"), folder("/ws/docs")],
        repoRoots: ["/ws/api"],
        worktrees: [{ repoRoot: "/ws/api", worktreePath: "/wt/api-feature" }],
      }),
    ).toEqual(["/wt/api-feature", "/ws/docs"]);
  });
});
