import { describe, expect, it } from "vite-plus/test";

import {
  fileRootFromTreePath,
  fileRootOpenPath,
  projectFileRoots,
} from "@t3tools/client-runtime/project-file-roots";

import { buildFileTree, fileRootDirectoryTreeEntries, fileRootTreeEntries } from "./fileTree";

describe("multi-root file tree", () => {
  const roots = projectFileRoots({
    cwd: "/work/context",
    projectName: "Context",
    folders: [
      { relativePath: ".", name: "context", path: "/work/context" },
      { relativePath: "../team-a/docs", name: "docs", path: "/work/team-a/docs" },
      { relativePath: "../team-b/docs", name: "docs", path: "/work/team-b/docs" },
    ],
  });

  it("shows one folder per root and groups same-named roots under their parent", () => {
    const tree = buildFileTree(fileRootTreeEntries(roots));
    expect(tree.map((node) => node.path)).toEqual(["context", "team-a", "team-b"]);
    expect(tree[1]?.children.map((node) => node.path)).toEqual(["team-a/docs"]);
  });

  it("files a root's listing under that root, keeping only direct children", () => {
    const target = fileRootFromTreePath(roots, "team-b/docs")!;
    const entries = fileRootDirectoryTreeEntries(roots, target, [
      { path: "plan.md", kind: "file" },
      { path: "drafts", kind: "directory" },
      { path: "drafts/todo.md", kind: "file" },
    ]);
    expect(entries.map((entry) => entry.path)).toEqual([
      "team-b/docs/plan.md",
      "team-b/docs/drafts",
    ]);
    const tree = buildFileTree([...fileRootTreeEntries(roots), ...entries]);
    const teamB = tree.find((node) => node.path === "team-b")!;
    expect(teamB.children[0]?.children.map((node) => node.path)).toEqual([
      "team-b/docs/drafts",
      "team-b/docs/plan.md",
    ]);
  });

  it("opens a row's file by the path the rest of the app names it by", () => {
    const inFolder = fileRootFromTreePath(roots, "context/src/main.ts")!;
    expect(fileRootOpenPath("/work/context", inFolder)).toBe("src/main.ts");
    const elsewhere = fileRootFromTreePath(roots, "team-a/docs/plan.md")!;
    expect(fileRootOpenPath("/work/context", elsewhere)).toBe("/work/team-a/docs/plan.md");
  });

  it("keeps an ordinary project's paths as they were", () => {
    const single = projectFileRoots({ cwd: "/work/app", folders: undefined });
    const target = fileRootFromTreePath(single, "src")!;
    expect(
      fileRootDirectoryTreeEntries(single, target, [{ path: "src/main.ts", kind: "file" }]),
    ).toEqual([{ path: "src/main.ts", kind: "file" }]);
  });
});
