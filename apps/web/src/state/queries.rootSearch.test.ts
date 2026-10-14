import { describe, expect, it } from "vite-plus/test";

import { mergeRootSearchResults } from "./queries";

const roots = [
  { label: "Web", path: "/work/web" },
  { label: "team-a/docs", path: "/work/team-a/docs" },
];

describe("mergeRootSearchResults", () => {
  it("interleaves each root's ranked entries under the root's label", () => {
    const merged = mergeRootSearchResults(
      roots,
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
      roots,
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
        roots,
        [
          { entries: [], truncated: true },
          { entries: [], truncated: false },
        ],
        5,
      ).truncated,
    ).toBe(true);
  });
});
