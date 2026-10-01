import { describe, expect, it } from "vite-plus/test";
import type { ProjectEntry } from "@t3tools/contracts";

import {
  buildFileTree,
  defaultExpandedTreePaths,
  flattenFileTree,
  resolveRootedTreePath,
  rootedTreePath,
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

describe("multi-root tree paths", () => {
  const roots = [
    { root: "/wt/api-5c882f59", label: "api" },
    { root: "/ws/a/docs", label: "a/docs" },
    { root: "/ws/b/docs/", label: "b/docs" },
    { root: "/ws/a/docs/drafts", label: "drafts" },
  ];

  it("resolves a tree path to its root and the path inside it", () => {
    expect(resolveRootedTreePath(roots, "api/src/main.ts")).toMatchObject({
      root: "/wt/api-5c882f59",
      relativePath: "src/main.ts",
    });
    expect(resolveRootedTreePath(roots, "a/docs")).toMatchObject({
      root: "/ws/a/docs",
      relativePath: "",
    });
    expect(resolveRootedTreePath(roots, "b/docs/plan.md")).toMatchObject({
      root: "/ws/b/docs/",
      relativePath: "plan.md",
    });
  });

  it("resolves nothing for a path under no root", () => {
    expect(resolveRootedTreePath(roots, "a")).toBeNull();
    expect(resolveRootedTreePath(roots, "apis/main.ts")).toBeNull();
  });

  it("maps an absolute path back under the innermost root that holds it", () => {
    expect(rootedTreePath(roots, "/wt/api-5c882f59/src/main.ts")).toBe("api/src/main.ts");
    expect(rootedTreePath(roots, "/ws/b/docs/plan.md")).toBe("b/docs/plan.md");
    expect(rootedTreePath(roots, "/ws/a/docs/drafts/todo.md")).toBe("drafts/todo.md");
    expect(rootedTreePath(roots, "/ws/api/src/main.ts")).toBeNull();
  });
});
