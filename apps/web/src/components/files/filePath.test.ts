import { describe, expect, it } from "vite-plus/test";

import {
  fileBreadcrumbChildren,
  fileBreadcrumbs,
  fileTreeEntryTarget,
  retainedBreadcrumbTrail,
  rootGroupFolder,
} from "./filePath";

describe("fileBreadcrumbs", () => {
  it("starts host paths outside the workspace at the filesystem root", () => {
    expect(fileBreadcrumbs("t3code", "/tmp/t3-cleanup/report.md")).toEqual([
      { label: "tmp", path: "/tmp", kind: "directory" },
      { label: "t3-cleanup", path: "/tmp/t3-cleanup", kind: "directory" },
      { label: "report.md", path: "/tmp/t3-cleanup/report.md", kind: "file" },
    ]);
    expect(fileBreadcrumbs("t3code", "C:\\Temp\\report.md")).toEqual([
      { label: "C:", path: "C:\\", kind: "directory" },
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

  it("honors segment boundaries and sorts folders before files", () => {
    expect(fileBreadcrumbChildren(entries, "src")).toEqual([
      { path: "src/lib", kind: "directory", label: "lib" },
      { path: "src/index.ts", kind: "file", label: "index.ts" },
    ]);
  });
});

describe("retainedBreadcrumbTrail", () => {
  it.each([
    // Walking up keeps the deeper path, all the way to the workspace root.
    ["apps/web/src", "apps/web", "apps/web/src"],
    ["apps/web/src", "", "apps/web/src"],
    // Walking back down inside the trail keeps it too.
    ["apps/web/src", "apps/web/src", "apps/web/src"],
    // Somewhere else starts over, including a sibling that shares a name prefix.
    ["apps/web/src", "apps/mobile", "apps/mobile"],
    ["src/lib", "src-old", "src-old"],
    ["apps/web", "apps/web/src/main.tsx", "apps/web/src/main.tsx"],
    // Workspace and host paths never share a trail.
    ["apps/web/src", "/tmp/report", "/tmp/report"],
    ["/tmp/report", "", ""],
    ["C:\\Temp\\a", "", ""],
    // Host folders outside the workspace keep their trail the same way.
    ["/Users/me/projects/scope", "/Users/me", "/Users/me/projects/scope"],
    ["/Users/me/projects/scope", "/Users/me/proj", "/Users/me/proj"],
    ["/Volumes/Work/a", "/Volumes/Work/a/", "/Volumes/Work/a"],
    ["C:\\Users\\me\\scope", "C:\\", "C:\\Users\\me\\scope"],
    ["C:\\Users\\me\\scope", "C:\\Users", "C:\\Users\\me\\scope"],
    ["C:\\Users\\me\\scope", "D:\\", "D:\\"],
    ["\\\\nas\\share\\docs\\notes", "\\\\nas\\share", "\\\\nas\\share\\docs\\notes"],
  ])("from trail %j to %j keeps %j", (trail, path, expected) => {
    expect(retainedBreadcrumbTrail(trail, path)).toBe(expected);
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
