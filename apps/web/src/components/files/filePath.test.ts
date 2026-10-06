import { describe, expect, it } from "vite-plus/test";

import {
  fileBreadcrumbChildren,
  fileBreadcrumbParent,
  fileBreadcrumbs,
  fileTreeEntryTarget,
  isRootPath,
  rootGroupFolder,
} from "./filePath";

describe("fileBreadcrumbs", () => {
  it("builds project, directory, and file crumbs", () => {
    expect(fileBreadcrumbs("t3code", "apps/web/src/main.tsx")).toEqual([
      { label: "t3code", path: "", kind: "project" },
      { label: "apps", path: "apps", kind: "directory" },
      { label: "web", path: "apps/web", kind: "directory" },
      { label: "src", path: "apps/web/src", kind: "directory" },
      { label: "main.tsx", path: "apps/web/src/main.tsx", kind: "file" },
    ]);
  });

  it("normalizes repeated separators", () => {
    expect(fileBreadcrumbs("workspace", "src//index.ts").map((crumb) => crumb.label)).toEqual([
      "workspace",
      "src",
      "index.ts",
    ]);
  });

  it("starts host paths outside the workspace at the filesystem root", () => {
    expect(fileBreadcrumbs("t3code", "/tmp/t3-cleanup/report.md")).toEqual([
      { label: "tmp", path: "/tmp", kind: "directory" },
      { label: "t3-cleanup", path: "/tmp/t3-cleanup", kind: "directory" },
      { label: "report.md", path: "/tmp/t3-cleanup/report.md", kind: "file" },
    ]);
    expect(fileBreadcrumbs("t3code", "C:\\Temp\\report.md")).toEqual([
      { label: "C:", path: "C:", kind: "directory" },
      { label: "Temp", path: "C:\\Temp", kind: "directory" },
      { label: "report.md", path: "C:\\Temp\\report.md", kind: "file" },
    ]);
    expect(fileBreadcrumbs("t3code", "\\\\server\\share\\report.md").map((c) => c.path)).toEqual([
      "\\\\server",
      "\\\\server\\share",
      "\\\\server\\share\\report.md",
    ]);
  });
});

describe("fileBreadcrumbChildren", () => {
  const entries = [
    { path: "README.md", kind: "file" as const },
    { path: "src", kind: "directory" as const },
    { path: "src-old", kind: "directory" as const },
    { path: "src/index.ts", kind: "file" as const },
    { path: "src/lib", kind: "directory" as const },
    { path: "src/lib/file10.ts", kind: "file" as const },
    { path: "src/lib/file2.ts", kind: "file" as const },
    { path: "src-old/index.ts", kind: "file" as const },
  ];

  it("returns only the immediate children of the project root", () => {
    expect(fileBreadcrumbChildren(entries, "")).toEqual([
      { path: "src", kind: "directory", label: "src" },
      { path: "src-old", kind: "directory", label: "src-old" },
      { path: "README.md", kind: "file", label: "README.md" },
    ]);
  });

  it("honors segment boundaries and sorts folders before files", () => {
    expect(fileBreadcrumbChildren(entries, "src")).toEqual([
      { path: "src/lib", kind: "directory", label: "lib" },
      { path: "src/index.ts", kind: "file", label: "index.ts" },
    ]);
  });

  it("uses natural file-name ordering and preserves input order for equivalent names", () => {
    const files = ["file10.ts", "File2.ts", "file02.ts", "file2.ts"].map((name) => ({
      path: `src/lib/${name}`,
      kind: "file" as const,
    }));

    expect(fileBreadcrumbChildren(files, "src/lib").map((entry) => entry.label)).toEqual([
      "File2.ts",
      "file02.ts",
      "file2.ts",
      "file10.ts",
    ]);
  });

  it("returns an empty list for an empty or missing directory", () => {
    expect(fileBreadcrumbChildren(entries, "missing")).toEqual([]);
  });
});

describe("fileBreadcrumbParent", () => {
  it.each([
    ["src/lib", "src"],
    ["src", ""],
    ["", null],
  ])("returns the parent of %j", (path, expected) => {
    expect(fileBreadcrumbParent(path)).toBe(expected);
  });
});

describe("isRootPath", () => {
  it("matches a root itself, not a path inside it", () => {
    const roots = ["/work/app", "/downloads/outlier/"];
    expect(isRootPath(roots, "/downloads/outlier")).toBe(true);
    expect(isRootPath(roots, "/work/app/")).toBe(true);
    expect(isRootPath(roots, "/work/app/src")).toBe(false);
    expect(isRootPath(undefined, "/work/app")).toBe(false);
  });
});

describe("fileTreeEntryTarget", () => {
  const cwd = "/home/user/dev/project";

  it("keeps the tree path under cwd for a single-root tree", () => {
    expect(
      fileTreeEntryTarget({
        treePath: "src/index.ts",
        cwd,
        root: undefined,
        relativePath: undefined,
      }),
    ).toEqual({ workspaceRoot: cwd, filePath: "src/index.ts", mentionPath: "src/index.ts" });
  });

  it("resolves a file in a root outside cwd through that root", () => {
    expect(
      fileTreeEntryTarget({
        treePath: "notes/ideas.md",
        cwd,
        root: "/home/user/dev/notes",
        relativePath: "ideas.md",
      }),
    ).toEqual({
      workspaceRoot: "/home/user/dev/notes",
      filePath: "ideas.md",
      mentionPath: "/home/user/dev/notes/ideas.md",
    });
  });

  it("resolves a file in a nested root through that root, not its label", () => {
    expect(
      fileTreeEntryTarget({
        treePath: "2026/plan.md",
        cwd,
        root: `${cwd}/notes/2026`,
        relativePath: "plan.md",
      }),
    ).toEqual({
      workspaceRoot: `${cwd}/notes/2026`,
      filePath: "plan.md",
      mentionPath: `${cwd}/notes/2026/plan.md`,
    });
  });

  it("names a root's own node from its parent folder", () => {
    expect(
      fileTreeEntryTarget({
        treePath: "notes",
        cwd,
        root: "/home/user/dev/notes/",
        relativePath: "",
      }),
    ).toEqual({
      workspaceRoot: "/home/user/dev",
      filePath: "notes",
      mentionPath: "/home/user/dev/notes",
    });
  });
});

describe("rootGroupFolder", () => {
  const roots = [
    { root: "/home/user/dev/dupe-a/docs", label: "dupe-a/docs" },
    { root: "/home/user/dev/dupe-b/docs/", label: "dupe-b/docs" },
    { root: "/home/user/dev/api", label: "api" },
  ];

  it("resolves a row that only groups roots to the folder they sit in", () => {
    expect(rootGroupFolder(roots, "dupe-a")).toBe("/home/user/dev/dupe-a");
    expect(rootGroupFolder(roots, "dupe-b")).toBe("/home/user/dev/dupe-b");
  });

  it("leaves roots and the rows inside them alone", () => {
    expect(rootGroupFolder(roots, "dupe-a/docs")).toBeUndefined();
    expect(rootGroupFolder(roots, "dupe-a/docs/guide")).toBeUndefined();
    expect(rootGroupFolder(roots, "api")).toBeUndefined();
    expect(rootGroupFolder(roots, "dupe")).toBeUndefined();
  });

  it("keeps a Windows root's separators", () => {
    expect(
      rootGroupFolder([{ root: "C:\\dev\\dupe-a\\docs", label: "dupe-a/docs" }], "dupe-a"),
    ).toBe("C:\\dev\\dupe-a");
  });

  it("names no folder for a worktree, whose path doesn't end in its label", () => {
    expect(
      rootGroupFolder(
        [{ root: "/home/user/.t3/worktrees/docs-feature", label: "dupe-a/docs" }],
        "dupe-a",
      ),
    ).toBeNull();
  });

  it("names no folder when the grouped roots sit in different folders", () => {
    expect(
      rootGroupFolder(
        [
          { root: "/x/shared/dupe-a/docs", label: "dupe-a/docs" },
          { root: "/y/dupe-a/notes", label: "dupe-a/notes" },
        ],
        "dupe-a",
      ),
    ).toBeNull();
  });
});
