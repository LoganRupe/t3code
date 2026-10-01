import { describe, expect, it } from "vite-plus/test";

import { resolveMarkdownFileLinkMeta } from "../markdown-links";
import { resolveProjectFileRoots } from "./projectFileRoots";

const folder = (absolutePath: string, exists = true) => ({ absolutePath, exists });
const paths = (roots: ReturnType<typeof resolveProjectFileRoots>) =>
  roots?.map((entry) => entry.root) ?? null;

describe("resolveProjectFileRoots", () => {
  it("spans every listed folder of a workspace file, git or not", () => {
    const roots = resolveProjectFileRoots({
      workspaceFolders: [folder("/ws/api"), folder("/ws/web"), folder("/ws/docs")],
      repoRoots: ["/ws/api", "/ws/web"],
      worktrees: [],
    });
    expect(paths(roots)).toEqual(["/ws/api", "/ws/web", "/ws/docs"]);
  });

  it("spans a one-repo workspace's listed folders instead of the workspace folder", () => {
    const roots = resolveProjectFileRoots({
      workspaceFolders: [folder("/ws/api"), folder("/ws/docs")],
      repoRoots: ["/ws/api"],
      worktrees: [],
    });
    expect(paths(roots)).toEqual(["/ws/api", "/ws/docs"]);
  });

  it("leaves out listed folders missing from disk", () => {
    const roots = resolveProjectFileRoots({
      workspaceFolders: [folder("/ws/api"), folder("/ws/gone", false), folder("/ws/docs")],
      repoRoots: ["/ws/api"],
      worktrees: [],
    });
    expect(paths(roots)).toEqual(["/ws/api", "/ws/docs"]);
  });

  it("falls back to multi-repo roots until the workspace file is read", () => {
    const multi = resolveProjectFileRoots({
      workspaceFolders: null,
      repoRoots: ["/ws/api", "/ws/web"],
      worktrees: [],
    });
    expect(paths(multi)).toEqual(["/ws/api", "/ws/web"]);
    const single = resolveProjectFileRoots({
      workspaceFolders: null,
      repoRoots: ["/ws/api"],
      worktrees: [],
    });
    expect(single).toBeNull();
  });

  it("uses the single cwd when fewer than two folders remain", () => {
    const roots = resolveProjectFileRoots({
      workspaceFolders: [folder("/ws/api"), folder("/ws/gone", false)],
      repoRoots: ["/ws/api"],
      worktrees: [],
    });
    expect(roots).toBeNull();
  });

  it("swaps a repo an isolated run covers for its worktree, keeping the repo's label", () => {
    const roots = resolveProjectFileRoots({
      workspaceFolders: [folder("/ws/api"), folder("/ws/docs")],
      repoRoots: ["/ws/api"],
      worktrees: [{ repoRoot: "/ws/api", worktreePath: "/wt/api/api-5c882f59" }],
    });
    expect(roots).toEqual([
      { root: "/wt/api/api-5c882f59", label: "api" },
      { root: "/ws/docs", label: "docs" },
    ]);
  });

  it("labels same-named folders by their parents", () => {
    const roots = resolveProjectFileRoots({
      workspaceFolders: [folder("/ws/a/docs"), folder("/ws/b/docs")],
      repoRoots: [],
      worktrees: [],
    });
    expect(roots?.map((entry) => entry.label)).toEqual(["a/docs", "b/docs"]);
  });

  // Chat file links are matched against these roots, so a link has to land on
  // the root the panel lists the file under or the tree cannot highlight it.
  it("claims chat links for nested, outside and worktree roots", () => {
    const roots = paths(
      resolveProjectFileRoots({
        workspaceFolders: [folder("/ws/api"), folder("/ws/notes/2026"), folder("/elsewhere/notes")],
        repoRoots: ["/ws/api"],
        worktrees: [{ repoRoot: "/ws/api", worktreePath: "/wt/feature/api" }],
      }),
    );
    const link = (path: string) =>
      resolveMarkdownFileLinkMeta(path, "/ws", undefined, roots ?? undefined);
    expect(link("/ws/notes/2026/plan.md")).toMatchObject({
      fileRoot: "/ws/notes/2026",
      workspaceRelativePath: "plan.md",
    });
    expect(link("/elsewhere/notes/todo.md")).toMatchObject({
      fileRoot: "/elsewhere/notes",
      workspaceRelativePath: "todo.md",
    });
    expect(link("/wt/feature/api/src/main.ts")).toMatchObject({
      fileRoot: "/wt/feature/api",
      workspaceRelativePath: "src/main.ts",
    });
  });
});
