import { describe, expect, it } from "vite-plus/test";

import {
  fileBreadcrumbChildren,
  fileBreadcrumbParent,
  fileBreadcrumbs,
  fileTreeEntryTarget,
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

describe("fileTreeEntryTarget", () => {
  const cwd = "/work/context";
  const roots = [
    { label: "context", path: "/work/context" },
    { label: "Web", path: "/work/context/web" },
    { label: "team-a/docs", path: "/work/team-a/docs" },
    { label: "team-b/docs", path: "/work/team-b/docs" },
  ];

  it("acts on the real file behind a labelled row", () => {
    expect(fileTreeEntryTarget({ roots, cwd, treePath: "team-a/docs/guide.md" })).toEqual({
      workspaceRoot: "/work/team-a/docs",
      filePath: "guide.md",
      mentionPath: "/work/team-a/docs/guide.md",
      openPath: "/work/team-a/docs/guide.md",
    });
    // A root inside the project folder is still named from the project folder.
    expect(fileTreeEntryTarget({ roots, cwd, treePath: "Web/src/main.ts" })).toEqual({
      workspaceRoot: "/work/context/web",
      filePath: "src/main.ts",
      mentionPath: "/work/context/web/src/main.ts",
      openPath: "/work/context/web/src/main.ts",
    });
    expect(fileTreeEntryTarget({ roots, cwd, treePath: "context/README.md" })).toEqual({
      workspaceRoot: "/work/context",
      filePath: "README.md",
      mentionPath: "README.md",
      openPath: "README.md",
    });
  });

  it("names a root's own row from its parent folder", () => {
    expect(fileTreeEntryTarget({ roots, cwd, treePath: "Web/" })).toEqual({
      workspaceRoot: "/work/context",
      filePath: "web",
      mentionPath: "/work/context/web",
      openPath: "/work/context/web",
    });
  });

  it("resolves a row that only groups roots to the folder they share, or to nothing", () => {
    expect(fileTreeEntryTarget({ roots, cwd, treePath: "team-a" })).toEqual({
      workspaceRoot: "/work",
      filePath: "team-a",
      mentionPath: "/work/team-a",
      openPath: "/work/team-a",
    });
    const worktrees = [
      { label: "client/app", path: "/runs/feature/app" },
      { label: "server/app", path: "/runs/feature/app-2" },
    ];
    expect(fileTreeEntryTarget({ roots: worktrees, cwd, treePath: "client" })).toBeNull();
    const drives = [
      { label: "C:/docs", path: "C:/docs" },
      { label: "D:/docs", path: "D:/docs" },
    ];
    expect(fileTreeEntryTarget({ roots: drives, cwd, treePath: "C:" })).toBeNull();
  });

  it("is the plain tree path for an ordinary project", () => {
    expect(
      fileTreeEntryTarget({ roots: [{ label: "context", path: cwd }], cwd, treePath: "src/a.ts" }),
    ).toEqual({
      workspaceRoot: cwd,
      filePath: "src/a.ts",
      mentionPath: "src/a.ts",
      openPath: "src/a.ts",
    });
  });
});

describe("rootGroupFolder", () => {
  it("finds the folder same-named roots sit in", () => {
    expect(
      rootGroupFolder(
        [
          { label: "team-a/docs", path: "/work/team-a/docs" },
          { label: "team-b/docs", path: "/work/team-b/docs" },
        ],
        "team-a",
      ),
    ).toBe("/work/team-a");
    expect(rootGroupFolder([{ label: "docs", path: "/work/docs" }], "docs")).toBeNull();
  });
});
