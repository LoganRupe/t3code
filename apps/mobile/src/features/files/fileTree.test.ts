import { describe, expect, it } from "vite-plus/test";
import type { ProjectEntry } from "@t3tools/contracts";

import {
  fileRootFromTreePath,
  fileRootOpenPath,
  projectFileRoots,
} from "@t3tools/client-runtime/project-file-roots";

import {
  buildFileTree,
  defaultExpandedTreePaths,
  fileRootDirectoryTreeEntries,
  fileRootTreeEntries,
  flattenFileTree,
} from "./fileTree";

const entries = [
  { kind: "file", path: "README.md" },
  { kind: "directory", path: "src" },
  { kind: "file", path: "src/index.ts" },
  { kind: "file", path: "src/components/App.tsx" },
  { kind: "file", path: "package.json" },
] satisfies ReadonlyArray<ProjectEntry>;

describe("mobile file tree helpers", () => {
  it("builds a deterministic hierarchy with directories before files", () => {
    const tree = buildFileTree(entries);

    expect(tree.map((node) => `${node.kind}:${node.path}`)).toEqual([
      "directory:src",
      "file:package.json",
      "file:README.md",
    ]);
    expect(tree[0]?.children.map((node) => `${node.kind}:${node.path}`)).toEqual([
      "directory:src/components",
      "file:src/index.ts",
    ]);
  });

  it("flattens expanded directories and hides collapsed descendants", () => {
    const tree = buildFileTree(entries);

    expect(
      flattenFileTree({
        nodes: tree,
        expanded: new Set(["src"]),
      }).map((item) => `${item.depth}:${item.node.path}`),
    ).toEqual(["0:src", "1:src/components", "1:src/index.ts", "0:package.json", "0:README.md"]);

    expect(
      flattenFileTree({
        nodes: tree,
        expanded: new Set(),
      }).map((item) => item.node.path),
    ).toEqual(["src", "package.json", "README.md"]);
  });

  it("includes matching descendants and their ancestors during search", () => {
    const tree = buildFileTree(entries);

    expect(
      flattenFileTree({
        nodes: tree,
        expanded: new Set(),
        searchQuery: "app",
      }).map((item) => item.node.path),
    ).toEqual(["src", "src/components", "src/components/App.tsx"]);
  });

  it("supports fuzzy, whitespace-separated path queries", () => {
    const tree = buildFileTree([
      {
        kind: "file",
        path: "docs/internals/workspace-layout.md",
      },
      {
        kind: "file",
        path: ".repos/alchemy-effect/examples/aws-lambda/src/JobNotifications.ts",
      },
      { kind: "directory", path: "apps/web/src/components/chat" },
      { kind: "file", path: "apps/web/src/components/chat/ChatHeader.test.ts" },
      { kind: "file", path: "apps/web/src/components/chat/ChatHeader.tsx" },
      { kind: "file", path: "apps/web/src/components/chat/Composer.tsx" },
    ]);

    const expectedPaths = [
      "apps",
      "apps/web",
      "apps/web/src",
      "apps/web/src/components",
      "apps/web/src/components/chat",
      "apps/web/src/components/chat/ChatHeader.test.ts",
      "apps/web/src/components/chat/ChatHeader.tsx",
    ];

    for (const searchQuery of ["chat hea", "cht hdr"]) {
      expect(
        flattenFileTree({
          nodes: tree,
          expanded: new Set(),
          searchQuery,
        }).map((item) => item.node.path),
      ).toEqual(expectedPaths);
    }
  });

  it("expands top-level directories by default", () => {
    const tree = buildFileTree(entries);

    expect([...defaultExpandedTreePaths(tree)]).toEqual(["src"]);
  });
});

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
