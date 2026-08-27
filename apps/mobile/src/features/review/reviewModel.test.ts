import { describe, expect, it } from "vite-plus/test";

import {
  MessageId,
  TurnId,
  type OrchestrationCheckpointSummary,
  type ReviewDiffPreviewSource,
} from "@t3tools/contracts";

import {
  buildReviewParsedDiff,
  buildReviewSectionItems,
  getDefaultReviewSectionId,
  getReviewFilePreviewState,
  getReviewSectionIdForCheckpoint,
  toReviewTurnDiff,
  type ReviewRenderableFile,
} from "./reviewModel";

function makeCheckpoint(
  input: Partial<OrchestrationCheckpointSummary> &
    Pick<OrchestrationCheckpointSummary, "turnId" | "checkpointTurnCount" | "completedAt">,
): OrchestrationCheckpointSummary {
  return {
    checkpointRef: `refs/t3/checkpoints/thread/${input.checkpointTurnCount}` as any,
    status: "ready",
    files: [],
    assistantMessageId: MessageId.make(`msg-${input.checkpointTurnCount}`),
    ...input,
  };
}

function makeRenderableFile(
  input: Partial<ReviewRenderableFile> & Pick<ReviewRenderableFile, "path">,
): ReviewRenderableFile {
  return {
    id: input.path,
    cacheKey: input.path,
    previousPath: null,
    changeType: "new",
    additions: 0,
    deletions: 0,
    languageHint: null,
    repoLabel: null,
    additionLines: [],
    deletionLines: [],
    rows: [],
    ...input,
  };
}

describe("buildReviewSectionItems", () => {
  it("keeps one chip per checkpoint and appends git sources", () => {
    const checkpoints = [
      makeCheckpoint({
        turnId: TurnId.make("turn-1"),
        checkpointTurnCount: 1,
        completedAt: "2026-04-01T00:00:00.000Z",
      }),
      makeCheckpoint({
        turnId: TurnId.make("turn-2"),
        checkpointTurnCount: 2,
        completedAt: "2026-04-02T00:00:00.000Z",
      }),
    ];
    const gitSections: ReviewDiffPreviewSource[] = [
      {
        id: "working-tree",
        kind: "working-tree",
        title: "Dirty worktree",
        baseRef: "HEAD",
        headRef: null,
        diff: "diff --git a/a.ts b/a.ts",
        diffHash: "hash-dirty",
        truncated: false,
      },
      {
        id: "branch-range",
        kind: "branch-range",
        title: "Against main",
        baseRef: "main",
        headRef: "feature",
        diff: "diff --git a/a.ts b/a.ts",
        diffHash: "hash-base",
        truncated: false,
      },
    ];

    const loadedTurnId = getReviewSectionIdForCheckpoint(checkpoints[0]);
    const items = buildReviewSectionItems({
      checkpoints,
      gitPreviews: [{ repoRoot: null, sources: gitSections }],
      turnDiffById: {
        [loadedTurnId]: { diff: "diff --git a/loaded.ts b/loaded.ts", groups: null },
      },
      loadingTurnIds: {
        [getReviewSectionIdForCheckpoint(checkpoints[1])]: true,
      },
      loadingGitSections: false,
    });

    expect(items.map((item) => item.id)).toEqual([
      "turn:2",
      "turn:1",
      "git:working-tree",
      "git:branch-range",
    ]);
    expect(items[0]).toMatchObject({ isLoading: true, diff: null });
    expect(items[1]).toMatchObject({
      isLoading: false,
      diff: expect.stringContaining("loaded.ts"),
    });
    expect(items[2]).toMatchObject({
      title: "Dirty worktree",
      subtitle: "Tracked, staged, and untracked worktree changes",
      diff: "diff --git a/a.ts b/a.ts",
      groups: null,
    });
    expect(items[3]).toMatchObject({ subtitle: "main ... feature", groups: null });
    expect(getDefaultReviewSectionId(items)).toBe("turn:2");
  });

  it("folds one preview per repo into grouped git sections", () => {
    const source = (
      kind: ReviewDiffPreviewSource["kind"],
      diff: string,
      baseRef: string | null,
    ): ReviewDiffPreviewSource => ({
      id: kind,
      kind,
      title: kind === "working-tree" ? "Dirty worktree" : "Against main",
      baseRef,
      headRef: kind === "working-tree" ? null : "feature",
      diff,
      diffHash: `${kind}:${diff}`,
      truncated: false,
    });

    const items = buildReviewSectionItems({
      checkpoints: [],
      gitPreviews: [
        {
          repoRoot: "/repos/workspace/api",
          sources: [
            source("working-tree", "", "HEAD"),
            source("branch-range", "api-branch", "main"),
          ],
        },
        {
          repoRoot: "/repos/workspace/web/",
          sources: [
            source("working-tree", "web-dirty", "HEAD"),
            source("branch-range", "web-branch", null),
          ],
        },
      ],
      turnDiffById: {},
      loadingTurnIds: {},
      loadingGitSections: false,
    });

    expect(items.map((item) => item.id)).toEqual(["git:working-tree", "git:branch-range"]);
    expect(items[0]).toMatchObject({
      diff: "\nweb-dirty",
      groups: [
        { repoRoot: "/repos/workspace/api", displayName: "api", diff: "" },
        { repoRoot: "/repos/workspace/web/", displayName: "web", diff: "web-dirty" },
      ],
    });
    expect(items[1]).toMatchObject({
      subtitle: "2 repositories",
      diff: "api-branch\nweb-branch",
    });
  });

  it("carries turn diff groups only for multi-repo threads", () => {
    const api = { repoRoot: "/repos/api", displayName: "api", diff: "a" };
    const web = { repoRoot: "/repos/web", displayName: "web", diff: "b" };
    expect(toReviewTurnDiff({ diff: "a", groups: [api] })).toEqual({ diff: "a", groups: null });
    expect(toReviewTurnDiff({ diff: "a" })).toEqual({ diff: "a", groups: null });
    expect(toReviewTurnDiff({ diff: "a\nb", groups: [api, web] })).toEqual({
      diff: "a\nb",
      groups: [api, web],
    });
  });

  it("shows dirty worktree while git preview is loading", () => {
    const items = buildReviewSectionItems({
      checkpoints: [],
      gitPreviews: [],
      turnDiffById: {},
      loadingTurnIds: {},
      loadingGitSections: true,
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: "git:working-tree",
        kind: "working-tree",
        title: "Dirty worktree",
        subtitle: "Tracked, staged, and untracked worktree changes",
        diff: null,
        isLoading: true,
      }),
    ]);
    expect(getDefaultReviewSectionId(items)).toBe("git:working-tree");
  });
});

describe("buildReviewParsedDiff", () => {
  it("labels files by repo when parsing a grouped diff", () => {
    const patch = (path: string) =>
      [
        `diff --git a/${path} b/${path}`,
        "index 1111111..2222222 100644",
        `--- a/${path}`,
        `+++ b/${path}`,
        "@@ -1,1 +1,1 @@",
        "-const before = 1;",
        "+const after = 2;",
      ].join("\n");
    const groups = [
      { repoRoot: "/repos/api", displayName: "api", diff: patch("src/server.ts") },
      { repoRoot: "/repos/web", displayName: "web", diff: "" },
      { repoRoot: "/repos/docs", displayName: "docs", diff: patch("README.md") },
    ];

    const parsed = buildReviewParsedDiff(
      groups.map((group) => group.diff).join("\n"),
      "unit",
      groups,
    );

    expect(parsed.kind).toBe("files");
    if (parsed.kind !== "files") {
      return;
    }
    expect(parsed.files.map((file) => [file.repoLabel, file.path])).toEqual([
      ["api", "src/server.ts"],
      ["docs", "README.md"],
    ]);
    expect(new Set(parsed.files.map((file) => file.id)).size).toBe(2);
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(2);

    const single = buildReviewParsedDiff(patch("src/server.ts"), "unit", [groups[0]!]);
    expect(single.kind === "files" && single.files[0]?.repoLabel).toBe("api");
    const flat = buildReviewParsedDiff(patch("src/server.ts"), "unit", null);
    expect(flat.kind === "files" && flat.files[0]?.repoLabel).toBeNull();
  });

  it("builds renderable rows from a unified patch", () => {
    const parsed = buildReviewParsedDiff(
      [
        "diff --git a/apps/mobile/src/a.ts b/apps/mobile/src/a.ts",
        "index 1111111..2222222 100644",
        "--- a/apps/mobile/src/a.ts",
        "+++ b/apps/mobile/src/a.ts",
        "@@ -1,2 +1,3 @@",
        "-const before = 1;",
        "+const after = 2;",
        "+console.log(after);",
        " return true;",
      ].join("\n"),
      "unit",
    );

    expect(parsed.kind).toBe("files");
    if (parsed.kind !== "files") {
      return;
    }

    expect(parsed.fileCount).toBe(1);
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(1);
    expect(parsed.files[0]).toMatchObject({
      path: "apps/mobile/src/a.ts",
      additions: 2,
      deletions: 1,
    });
    expect(parsed.files[0]?.rows).toEqual([
      expect.objectContaining({ kind: "hunk", header: "@@ -1,2 +1,3 @@" }),
      expect.objectContaining({
        kind: "line",
        change: "delete",
        oldLineNumber: 1,
        newLineNumber: null,
        content: "const before = 1;",
        comparison: { change: "add", tokenIndex: 0 },
      }),
      expect.objectContaining({
        kind: "line",
        change: "add",
        oldLineNumber: null,
        newLineNumber: 1,
        content: "const after = 2;",
        comparison: { change: "delete", tokenIndex: 0 },
      }),
      expect.objectContaining({
        kind: "line",
        change: "add",
        oldLineNumber: null,
        newLineNumber: 2,
        content: "console.log(after);",
        comparison: null,
      }),
      expect.objectContaining({
        kind: "line",
        change: "context",
        oldLineNumber: 2,
        newLineNumber: 3,
        content: "return true;",
        comparison: null,
      }),
    ]);
  });

  it("treats truncated patches as partial diffs instead of failing", () => {
    const parsed = buildReviewParsedDiff(
      [
        "diff --git a/apps/mobile/src/a.ts b/apps/mobile/src/a.ts",
        "index 1111111..2222222 100644",
        "--- a/apps/mobile/src/a.ts",
        "+++ b/apps/mobile/src/a.ts",
        "@@ -1 +1,2 @@",
        " const before = 1;",
        "+const after = 2;",
        "",
        "[truncated]",
      ].join("\n"),
      "unit-truncated",
    );

    expect(parsed.kind).toBe("files");
    if (parsed.kind !== "files") {
      return;
    }

    expect(parsed.notice).toContain("server size cap");
    expect(parsed.fileCount).toBe(1);
    expect(parsed.files[0]?.rows[0]).toMatchObject({
      kind: "hunk",
      header: "@@ -1,1 +1,2 @@",
    });
  });

  it("suppresses preview for non-text file formats", () => {
    const preview = getReviewFilePreviewState(
      makeRenderableFile({
        path: "apps/mobile/assets/icon.png",
      }),
    );

    expect(preview).toMatchObject({
      kind: "suppressed",
      reason: "non-text",
      title: "Non-text file",
      actionLabel: null,
    });
  });

  it("suppresses large diffs until explicitly requested", () => {
    const preview = getReviewFilePreviewState(
      makeRenderableFile({
        path: "apps/mobile/src/big.ts",
        rows: Array.from({ length: 401 }, (_, index) => ({
          kind: "line" as const,
          id: `line-${index}`,
          change: "add" as const,
          oldLineNumber: null,
          newLineNumber: index + 1,
          content: `const line${index} = ${index};`,
          additionTokenIndex: index,
          deletionTokenIndex: null,
          comparison: null,
        })),
      }),
    );

    expect(preview).toMatchObject({
      kind: "suppressed",
      reason: "large",
      title: "Large diff",
      actionLabel: "Load diff",
    });
  });
});
