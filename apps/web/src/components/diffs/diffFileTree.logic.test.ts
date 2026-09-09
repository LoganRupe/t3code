import type { FileDiffMetadata } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDiffFileTreeUpdates,
  collectDirectoryPaths,
  diffFileTreeEntries,
  groupedDiffFileTreeEntries,
  groupedDiffFileTreePath,
} from "./diffFileTree.logic";

function file(type: FileDiffMetadata["type"], name: string, prevName = name): FileDiffMetadata {
  return { type, name: `b/${name}`, prevName: `a/${prevName}` } as FileDiffMetadata;
}

describe("diffFileTreeEntries", () => {
  it("maps each change type to its git status under the file's current path", () => {
    expect(
      diffFileTreeEntries([
        file("new", "src/a.ts"),
        file("deleted", "src/b.ts"),
        file("rename-pure", "src/c.ts", "src/old-c.ts"),
        file("rename-changed", "src/d.ts", "src/old-d.ts"),
        file("change", "README.md"),
      ]),
    ).toEqual([
      { path: "src/a.ts", status: "added" },
      { path: "src/b.ts", status: "deleted" },
      { path: "src/c.ts", status: "renamed" },
      { path: "src/d.ts", status: "renamed" },
      { path: "README.md", status: "modified" },
    ]);
  });

  it("keeps the first of two files at the same path so the tree never throws on a duplicate", () => {
    expect(diffFileTreeEntries([file("change", "README.md"), file("new", "README.md")])).toEqual([
      { path: "README.md", status: "modified" },
    ]);
  });
});

describe("groupedDiffFileTreeEntries", () => {
  const groups = [
    { label: "api", files: [file("change", "README.md"), file("new", "src/a.ts")] },
    { label: "web", files: [file("change", "README.md")] },
  ];

  it("files each repo's changes under a folder named for the repo", () => {
    expect(groupedDiffFileTreeEntries(groups)).toEqual([
      { path: "api/README.md", status: "modified" },
      { path: "api/src/a.ts", status: "added" },
      { path: "web/README.md", status: "modified" },
    ]);
  });

  it("drops a repeat when two roots share a folder name", () => {
    expect(
      groupedDiffFileTreeEntries([
        { label: "app", files: [file("change", "README.md")] },
        { label: "app", files: [file("change", "README.md"), file("new", "b.ts")] },
      ]),
    ).toEqual([
      { path: "app/README.md", status: "modified" },
      { path: "app/b.ts", status: "added" },
    ]);
  });

  it("resolves a repo-relative path to the first group that changed it", () => {
    expect(groupedDiffFileTreePath(groups, "README.md")).toBe("api/README.md");
    expect(groupedDiffFileTreePath(groups, "src/a.ts")).toBe("api/src/a.ts");
    expect(groupedDiffFileTreePath(groups, "missing.ts")).toBeNull();
  });
});

describe("collectDirectoryPaths", () => {
  it("lists every ancestor once, parents first, with Pierre's trailing slash", () => {
    expect(collectDirectoryPaths(["apps/web/src/a.ts", "apps/web/b.ts", "README.md"])).toEqual([
      "apps/",
      "apps/web/",
      "apps/web/src/",
    ]);
  });
});

describe("buildDiffFileTreeUpdates", () => {
  it("adds a new file's directories before the file", () => {
    expect(buildDiffFileTreeUpdates(["README.md"], ["README.md", "src/lib/a.ts"])).toEqual([
      { type: "add", path: "src/" },
      { type: "add", path: "src/lib/" },
      { type: "add", path: "src/lib/a.ts" },
    ]);
  });

  it("removes files before their now-empty directories, deepest first", () => {
    expect(buildDiffFileTreeUpdates(["src/lib/a.ts", "src/b.ts"], ["src/b.ts"])).toEqual([
      { type: "remove", path: "src/lib/a.ts" },
      { type: "remove", path: "src/lib/", recursive: true },
    ]);
  });

  it("keeps a directory that still holds a file", () => {
    expect(buildDiffFileTreeUpdates(["src/a.ts", "src/b.ts"], ["src/b.ts"])).toEqual([
      { type: "remove", path: "src/a.ts" },
    ]);
  });

  it("produces nothing when the paths are unchanged", () => {
    expect(buildDiffFileTreeUpdates(["src/a.ts"], ["src/a.ts"])).toEqual([]);
  });
});
