import { describe, expect, it } from "vite-plus/test";

import { buildRootLabels, labelForRoot, resolveProjectFileRoots } from "./projectFileRoots.ts";

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
});

describe("buildRootLabels", () => {
  it("labels roots by folder name and grows the label when names collide", () => {
    const labels = buildRootLabels(["/work/app", "/a/shared", "/b/shared"]);
    expect(labelForRoot(labels, "/work/app")).toBe("app");
    expect(labelForRoot(labels, "/a/shared")).toBe("a/shared");
    expect(labelForRoot(labels, "/b/shared/")).toBe("b/shared");
  });

  it("never gives one root a label that is a path prefix of another's", () => {
    // /y/api/docs grows to api/docs to differ from /z/docs, which would nest it under /x/api.
    const labels = buildRootLabels(["/x/api", "/y/api/docs", "/z/docs"]);
    expect(labelForRoot(labels, "/x/api")).toBe("x/api");
    expect(labelForRoot(labels, "/y/api/docs")).toBe("api/docs");
    expect(labelForRoot(labels, "/z/docs")).toBe("z/docs");
  });

  it("grows the longer label when the shorter one is already the whole path", () => {
    const labels = buildRootLabels(["/api", "/y/api/docs", "/z/docs"]);
    expect(labelForRoot(labels, "/api")).toBe("api");
    expect(labelForRoot(labels, "/y/api/docs")).toBe("y/api/docs");
    expect(labelForRoot(labels, "/z/docs")).toBe("z/docs");
  });
});
