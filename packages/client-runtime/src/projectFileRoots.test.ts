import { describe, expect, it } from "vite-plus/test";

import {
  buildRootLabels,
  fileRootForPath,
  fileRootFromTreePath,
  fileRootOpenPath,
  fileRootTreePath,
  mergeRootSearchResults,
  projectFileRoots,
} from "./projectFileRoots.ts";

const cwd = "/work/context";
const folders = [
  { relativePath: ".", name: "context", path: "/work/context" },
  { relativePath: "web", name: "Web", path: "/work/context/web" },
  { relativePath: "../team-a/docs", name: "docs", path: "/work/team-a/docs" },
  { relativePath: "../team-b/docs", name: "docs", path: "/work/team-b/docs" },
];
const roots = projectFileRoots({ cwd, projectName: "Context", folders });

describe("projectFileRoots", () => {
  it("is the project folder alone without listed folders", () => {
    expect(projectFileRoots({ cwd, projectName: "Context", folders: undefined })).toEqual([
      { label: "Context", path: cwd },
    ]);
    expect(projectFileRoots({ cwd, folders: [] })).toEqual([{ label: "context", path: cwd }]);
  });

  it("names roots after the workspace file and tells same-named folders apart", () => {
    expect(roots).toEqual([
      { label: "context", path: "/work/context" },
      { label: "Web", path: "/work/context/web" },
      { label: "team-a/docs", path: "/work/team-a/docs" },
      { label: "team-b/docs", path: "/work/team-b/docs" },
    ]);
  });

  it("keeps a label from being a path prefix of another", () => {
    expect(
      buildRootLabels([
        { name: "api", path: "/work/api" },
        { name: "docs", path: "/work/api/docs" },
        { name: "docs", path: "/other/docs" },
      ]),
    ).toEqual(["work/api", "api/docs", "other/docs"]);
    expect(buildRootLabels([{ name: "a/b", path: "C:\\work\\a" }])).toEqual(["a-b"]);
  });
});

describe("tree paths", () => {
  it("prefixes entries with their root's label only when there are several roots", () => {
    const web = roots[1]!;
    expect(fileRootTreePath(roots, { root: web, relativePath: "src/main.ts" })).toBe(
      "Web/src/main.ts",
    );
    expect(fileRootTreePath(roots, { root: web, relativePath: "" })).toBe("Web");
    const single = projectFileRoots({ cwd, projectName: "Context", folders: undefined });
    expect(fileRootTreePath(single, { root: single[0]!, relativePath: "src/main.ts" })).toBe(
      "src/main.ts",
    );
  });

  it("maps a tree path back to the longest matching root", () => {
    expect(fileRootFromTreePath(roots, "team-a/docs/guide.md")).toEqual({
      root: roots[2],
      relativePath: "guide.md",
    });
    expect(fileRootFromTreePath(roots, "Web/")).toEqual({ root: roots[1], relativePath: "" });
    // A segment that only groups same-named roots belongs to none of them.
    expect(fileRootFromTreePath(roots, "team-a")).toBeNull();
    const single = projectFileRoots({ cwd, projectName: "Context", folders: undefined });
    expect(fileRootFromTreePath(single, "src/main.ts")).toEqual({
      root: single[0],
      relativePath: "src/main.ts",
    });
  });
});

describe("fileRootForPath", () => {
  it("finds the innermost root holding an absolute or cwd-relative path", () => {
    expect(fileRootForPath(roots, cwd, "/work/context/web/src/main.ts")).toEqual({
      root: roots[1],
      relativePath: "src/main.ts",
    });
    expect(fileRootForPath(roots, cwd, "web/src/main.ts")).toEqual({
      root: roots[1],
      relativePath: "src/main.ts",
    });
    expect(fileRootForPath(roots, cwd, "README.md")).toEqual({
      root: roots[0],
      relativePath: "README.md",
    });
    expect(fileRootForPath(roots, cwd, "/work/team-b/docs")).toEqual({
      root: roots[3],
      relativePath: "",
    });
    expect(fileRootForPath(roots, cwd, "/tmp/report.md")).toBeNull();
  });
});

describe("fileRootOpenPath", () => {
  it("names files in the project folder relatively and others absolutely", () => {
    expect(fileRootOpenPath(cwd, { root: roots[0]!, relativePath: "README.md" })).toBe("README.md");
    expect(fileRootOpenPath(cwd, { root: roots[0]!, relativePath: "" })).toBe(".");
    expect(fileRootOpenPath(cwd, { root: roots[1]!, relativePath: "src/main.ts" })).toBe(
      "/work/context/web/src/main.ts",
    );
    expect(fileRootOpenPath(cwd, { root: roots[2]!, relativePath: "" })).toBe("/work/team-a/docs");
  });
});

const searchRoots = [
  { label: "Web", path: "/work/web" },
  { label: "team-a/docs", path: "/work/team-a/docs" },
];

describe("mergeRootSearchResults", () => {
  it("interleaves each root's ranked entries under the root's label", () => {
    const merged = mergeRootSearchResults(
      searchRoots,
      [
        {
          entries: [
            { path: "src/main.ts", kind: "file" },
            { path: "src/app.ts", kind: "file" },
          ],
          truncated: false,
        },
        { entries: [{ path: "guide.md", kind: "file" }], truncated: false },
      ],
      10,
    );
    expect(merged).toEqual({
      entries: [
        { path: "Web/src/main.ts", kind: "file" },
        { path: "team-a/docs/guide.md", kind: "file" },
        { path: "Web/src/app.ts", kind: "file" },
      ],
      truncated: false,
    });
  });

  it("stops at the limit and reports what it left out as truncated", () => {
    const merged = mergeRootSearchResults(
      searchRoots,
      [
        {
          entries: [
            { path: "a.ts", kind: "file" },
            { path: "b.ts", kind: "file" },
          ],
          truncated: false,
        },
        { entries: [{ path: "c.md", kind: "file" }], truncated: false },
      ],
      2,
    );
    expect(merged.entries.map((entry) => entry.path)).toEqual(["Web/a.ts", "team-a/docs/c.md"]);
    expect(merged.truncated).toBe(true);
    expect(
      mergeRootSearchResults(
        searchRoots,
        [
          { entries: [], truncated: true },
          { entries: [], truncated: false },
        ],
        5,
      ).truncated,
    ).toBe(true);
  });
});
