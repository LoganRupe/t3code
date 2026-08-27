import { parsePatchFiles } from "@pierre/diffs/utils/parsePatchFiles";
import type { ChangeTypes, FileDiffMetadata } from "@pierre/diffs/types";
import type { OrchestrationCheckpointSummary, ReviewDiffPreviewSource } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Order from "effect/Order";

export type ReviewSectionKind = "turn" | "working-tree" | "branch-range";

const DIRTY_WORKTREE_SECTION_ID = "git:working-tree";
const DIRTY_WORKTREE_TITLE = "Dirty worktree";
const DIRTY_WORKTREE_SUBTITLE = "Tracked, staged, and untracked worktree changes";

/**
 * One repo's slice of a multi-repo diff. Shape matches the server's turn diff
 * `groups[]`; git previews are folded into the same shape per fan-out target.
 */
export interface ReviewDiffGroup {
  readonly repoRoot: string;
  /** Repo folder name, the label files carry in the review list. */
  readonly displayName: string;
  readonly diff: string;
}

/** A git diff preview for one cwd; `repoRoot` is null for a single-repo thread's single-cwd diff. */
export interface ReviewGitPreview {
  readonly repoRoot: string | null;
  readonly sources: ReadonlyArray<ReviewDiffPreviewSource>;
}

export interface ReviewTurnDiff {
  readonly diff: string;
  /** Per-repo slices of `diff`; null unless the thread spans more than one repo. */
  readonly groups: ReadonlyArray<ReviewDiffGroup> | null;
}

export interface ReviewSectionItem {
  readonly id: string;
  readonly kind: ReviewSectionKind;
  readonly title: string;
  readonly subtitle: string | null;
  readonly diff: string | null;
  /** Per-repo slices of `diff`; null unless the thread spans more than one repo. */
  readonly groups: ReadonlyArray<ReviewDiffGroup> | null;
  readonly isLoading: boolean;
}

export interface ReviewRenderableHunkRow {
  readonly kind: "hunk";
  readonly id: string;
  readonly header: string;
  readonly context: string | null;
}

export interface ReviewRenderableLineRow {
  readonly kind: "line";
  readonly id: string;
  readonly change: "context" | "add" | "delete";
  readonly oldLineNumber: number | null;
  readonly newLineNumber: number | null;
  readonly content: string;
  readonly additionTokenIndex: number | null;
  readonly deletionTokenIndex: number | null;
  readonly comparison: {
    readonly change: "add" | "delete";
    readonly tokenIndex: number;
  } | null;
}

export type ReviewRenderableRow = ReviewRenderableHunkRow | ReviewRenderableLineRow;

export interface ReviewRenderableFile {
  readonly id: string;
  readonly cacheKey: string;
  readonly path: string;
  readonly previousPath: string | null;
  readonly changeType: ChangeTypes;
  readonly additions: number;
  readonly deletions: number;
  readonly languageHint: string | null;
  /** Repo folder name for files of a multi-repo diff; null when the thread has one repo. */
  readonly repoLabel: string | null;
  readonly additionLines: ReadonlyArray<string>;
  readonly deletionLines: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReviewRenderableRow>;
}

export type ReviewFilePreviewState =
  | {
      readonly kind: "render";
    }
  | {
      readonly kind: "suppressed";
      readonly reason: "non-text" | "large";
      readonly title: string;
      readonly message: string;
      readonly actionLabel: string | null;
    };

export type ReviewParsedDiff =
  | {
      readonly kind: "empty";
    }
  | {
      readonly kind: "raw";
      readonly text: string;
      readonly reason: string;
      readonly notice: string | null;
    }
  | {
      readonly kind: "files";
      readonly files: ReadonlyArray<ReviewRenderableFile>;
      readonly fileCount: number;
      readonly additions: number;
      readonly deletions: number;
      readonly notice: string | null;
    };

function checkpointTitle(checkpoint: OrchestrationCheckpointSummary): string {
  return `Turn ${checkpoint.checkpointTurnCount}`;
}

function checkpointSubtitle(checkpoint: OrchestrationCheckpointSummary): string {
  const fileCount = checkpoint.files.length;
  if (checkpoint.status !== "ready") {
    return `Diff ${checkpoint.status}`;
  }
  return `${fileCount} file${fileCount === 1 ? "" : "s"} changed`;
}

function compareCheckpointTurnCountDescending(
  left: OrchestrationCheckpointSummary,
  right: OrchestrationCheckpointSummary,
): -1 | 0 | 1 {
  if (left.checkpointTurnCount === right.checkpointTurnCount) {
    return 0;
  }

  return left.checkpointTurnCount > right.checkpointTurnCount ? -1 : 1;
}

const readyCheckpointOrder = Order.make<OrchestrationCheckpointSummary>(
  compareCheckpointTurnCountDescending,
);

function gitSubtitle(section: ReviewDiffPreviewSource): string | null {
  if (section.kind === "working-tree") {
    return DIRTY_WORKTREE_SUBTITLE;
  }
  if (section.baseRef) {
    return `${section.baseRef} ... ${section.headRef ?? "HEAD"}`;
  }
  return "Base branch unavailable";
}

/** Last path segment of a repo root, the label a repo gets in a multi-repo diff. */
export function repoRootDisplayName(repoRoot: string): string {
  const trimmed = repoRoot.replace(/[/\\]+$/, "");
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1) : trimmed;
  return name.length > 0 ? name : repoRoot;
}

/** The flat patch behind a grouped diff, the same concatenation the server uses. */
function joinGroupDiffs(groups: ReadonlyArray<ReviewDiffGroup>): string {
  return groups.map((group) => group.diff).join("\n");
}

/**
 * Server turn diffs always carry `groups`, one per repo root. Only a thread that
 * spans several repos needs the per-repo split; a single group is the flat diff.
 */
export function toReviewTurnDiff(result: {
  readonly diff: string;
  readonly groups?: ReadonlyArray<ReviewDiffGroup> | undefined;
}): ReviewTurnDiff {
  return {
    diff: result.diff,
    groups: result.groups !== undefined && result.groups.length > 1 ? result.groups : null,
  };
}

function stripGitPrefix(pathValue: string | undefined): string | null {
  if (!pathValue) {
    return null;
  }
  if (pathValue.startsWith("a/") || pathValue.startsWith("b/")) {
    return pathValue.slice(2);
  }
  return pathValue;
}

function stripTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function splitTruncationMarker(diff: string): {
  readonly text: string;
  readonly truncated: boolean;
} {
  const trimmed = diff.trimEnd();
  if (!trimmed.endsWith("[truncated]")) {
    return { text: trimmed, truncated: false };
  }

  return {
    text: trimmed.replace(/\n*\[truncated\]\s*$/, "").trimEnd(),
    truncated: true,
  };
}

function runDiffParserSilently<T>(callback: () => T): T {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    return callback();
  } finally {
    console.error = originalConsoleError;
  }
}

const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const SECONDARY_HASH_SEED = 0x9e3779b9;
const SECONDARY_HASH_MULTIPLIER = 0x85ebca6b;
const LARGE_DIFF_LINE_THRESHOLD = 400;
const LARGE_DIFF_CHARACTER_THRESHOLD = 24_000;
const NON_TEXT_FILE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "icns",
  "avif",
  "heic",
  "tif",
  "tiff",
  "mp3",
  "wav",
  "flac",
  "ogg",
  "m4a",
  "aac",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "bz2",
  "7z",
  "rar",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "wasm",
  "exe",
  "dll",
  "so",
  "dylib",
]);

function fnv1a32(input: string, seed: number, multiplier: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, multiplier) >>> 0;
  }
  return hash >>> 0;
}

function buildPatchCacheKey(patch: string, scope: string): string {
  const normalizedPatch = patch.trim();
  const primary = fnv1a32(normalizedPatch, FNV_OFFSET_BASIS_32, FNV_PRIME_32).toString(36);
  const secondary = fnv1a32(
    normalizedPatch,
    SECONDARY_HASH_SEED,
    SECONDARY_HASH_MULTIPLIER,
  ).toString(36);
  return `${scope}:${normalizedPatch.length}:${primary}:${secondary}`;
}

function getFileExtension(path: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  return match?.[1]?.toLowerCase() ?? null;
}

function countReviewRenderableLineRows(file: ReviewRenderableFile): number {
  return file.rows.reduce((total, row) => total + (row.kind === "line" ? 1 : 0), 0);
}

function countReviewRenderableCharacters(file: ReviewRenderableFile): number {
  return file.rows.reduce(
    (total, row) => total + (row.kind === "line" ? row.content.length : row.header.length),
    0,
  );
}

export function getReviewFilePreviewState(file: ReviewRenderableFile): ReviewFilePreviewState {
  const extension = getFileExtension(file.path);
  if (extension && NON_TEXT_FILE_EXTENSIONS.has(extension)) {
    return {
      kind: "suppressed",
      reason: "non-text",
      title: "Non-text file",
      message: "Diff preview is not available for this file format.",
      actionLabel: null,
    };
  }

  const lineCount = countReviewRenderableLineRows(file);
  const characterCount = countReviewRenderableCharacters(file);
  if (lineCount > LARGE_DIFF_LINE_THRESHOLD || characterCount > LARGE_DIFF_CHARACTER_THRESHOLD) {
    return {
      kind: "suppressed",
      reason: "large",
      title: "Large diff",
      message: "Large diffs are not rendered by default.",
      actionLabel: "Load diff",
    };
  }

  return { kind: "render" };
}

function fallbackHunkHeader(hunk: FileDiffMetadata["hunks"][number]): string {
  return `@@ -${hunk.deletionStart},${hunk.deletionCount} +${hunk.additionStart},${hunk.additionCount} @@`;
}

function buildRenderableRows(file: FileDiffMetadata): ReadonlyArray<ReviewRenderableRow> {
  const rows: ReviewRenderableRow[] = [];
  let rowIndex = 0;

  file.hunks.forEach((hunk, hunkIndex) => {
    rows.push({
      kind: "hunk",
      id: `${file.cacheKey ?? file.name}:hunk:${hunkIndex}`,
      header: fallbackHunkHeader(hunk),
      context: hunk.hunkContext ? stripTrailingNewline(hunk.hunkContext) : null,
    });

    let deletionLineNumber = hunk.deletionStart;
    let additionLineNumber = hunk.additionStart;
    let deletionTokenIndex = hunk.deletionLineIndex;
    let additionTokenIndex = hunk.additionLineIndex;

    hunk.hunkContent.forEach((segment) => {
      if (segment.type === "context") {
        for (let index = 0; index < segment.lines; index += 1) {
          rows.push({
            kind: "line",
            id: `${file.cacheKey ?? file.name}:row:${rowIndex++}`,
            change: "context",
            oldLineNumber: deletionLineNumber,
            newLineNumber: additionLineNumber,
            content: stripTrailingNewline(
              file.additionLines[additionTokenIndex] ??
                file.deletionLines[deletionTokenIndex] ??
                "",
            ),
            additionTokenIndex,
            deletionTokenIndex,
            comparison: null,
          });
          deletionLineNumber += 1;
          additionLineNumber += 1;
          deletionTokenIndex += 1;
          additionTokenIndex += 1;
        }
        return;
      }

      const pairedLineCount = Math.min(segment.deletions, segment.additions);
      const deletionTokenIndexStart = deletionTokenIndex;
      const additionTokenIndexStart = additionTokenIndex;

      for (let index = 0; index < segment.deletions; index += 1) {
        rows.push({
          kind: "line",
          id: `${file.cacheKey ?? file.name}:row:${rowIndex++}`,
          change: "delete",
          oldLineNumber: deletionLineNumber,
          newLineNumber: null,
          content: stripTrailingNewline(file.deletionLines[deletionTokenIndex] ?? ""),
          additionTokenIndex: null,
          deletionTokenIndex,
          comparison:
            index < pairedLineCount
              ? {
                  change: "add",
                  tokenIndex: additionTokenIndexStart + index,
                }
              : null,
        });
        deletionLineNumber += 1;
        deletionTokenIndex += 1;
      }

      for (let index = 0; index < segment.additions; index += 1) {
        rows.push({
          kind: "line",
          id: `${file.cacheKey ?? file.name}:row:${rowIndex++}`,
          change: "add",
          oldLineNumber: null,
          newLineNumber: additionLineNumber,
          content: stripTrailingNewline(file.additionLines[additionTokenIndex] ?? ""),
          additionTokenIndex,
          deletionTokenIndex: null,
          comparison:
            index < pairedLineCount
              ? {
                  change: "delete",
                  tokenIndex: deletionTokenIndexStart + index,
                }
              : null,
        });
        additionLineNumber += 1;
        additionTokenIndex += 1;
      }
    });
  });

  return rows;
}

function mapRenderableFile(file: FileDiffMetadata, repoLabel: string | null): ReviewRenderableFile {
  const path = stripGitPrefix(file.name) ?? stripGitPrefix(file.prevName) ?? file.name;
  const previousPath = stripGitPrefix(file.prevName);
  const additions = file.hunks.reduce((total, hunk) => total + hunk.additionLines, 0);
  const deletions = file.hunks.reduce((total, hunk) => total + hunk.deletionLines, 0);
  const cacheKey = file.cacheKey ?? `${previousPath ?? "none"}:${path}:${file.type}`;

  return {
    id: cacheKey,
    cacheKey,
    path,
    previousPath,
    changeType: file.type,
    additions,
    deletions,
    languageHint: file.lang ?? null,
    repoLabel,
    additionLines: file.additionLines,
    deletionLines: file.deletionLines,
    rows: buildRenderableRows(file),
  };
}

/** Parses one unified patch into renderable files. Throws on malformed input. */
function parseRenderableFiles(
  text: string,
  cacheScope: string,
  repoLabel: string | null,
): ReadonlyArray<ReviewRenderableFile> {
  const parsedPatches = runDiffParserSilently(() =>
    parsePatchFiles(text, buildPatchCacheKey(text, cacheScope)),
  );
  return pipe(
    parsedPatches,
    Arr.flatMap((patch) => patch.files),
    Arr.map((file) => mapRenderableFile(file, repoLabel)),
  );
}

export function getReviewSectionIdForCheckpoint(
  checkpoint: Pick<OrchestrationCheckpointSummary, "checkpointTurnCount">,
): string {
  return `turn:${checkpoint.checkpointTurnCount}`;
}

export function getReadyReviewCheckpoints(
  checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>,
): ReadonlyArray<OrchestrationCheckpointSummary> {
  return pipe(
    checkpoints,
    Arr.filter((checkpoint) => checkpoint.status === "ready"),
    Arr.sort(readyCheckpointOrder),
  );
}

/**
 * Folds one git preview per repo into one section per source kind. A
 * single-repo thread has one preview with no repo root and keeps the flat
 * source; a multi-repo thread's previews become the section's `groups`, so
 * every repo's changes list under the one Working tree / Branch entry.
 */
function buildGitSectionItems(
  previews: ReadonlyArray<ReviewGitPreview>,
): ReadonlyArray<ReviewSectionItem> {
  const kinds = Array.from(
    new Set(previews.flatMap((preview) => preview.sources.map((source) => source.kind))),
  );
  return kinds.flatMap<ReviewSectionItem>((kind) => {
    const slices = previews.flatMap((preview) => {
      const source = preview.sources.find((candidate) => candidate.kind === kind);
      return source ? [{ repoRoot: preview.repoRoot, source }] : [];
    });
    const first = slices[0];
    if (!first) {
      return [];
    }
    const groups = slices.flatMap((slice) =>
      slice.repoRoot === null
        ? []
        : [
            {
              repoRoot: slice.repoRoot,
              displayName: repoRootDisplayName(slice.repoRoot),
              diff: slice.source.diff,
            },
          ],
    );
    const subtitles = new Set(slices.map((slice) => gitSubtitle(slice.source)));
    return [
      {
        id: `git:${kind}`,
        kind,
        title: first.source.title,
        subtitle:
          subtitles.size === 1 ? gitSubtitle(first.source) : `${slices.length} repositories`,
        diff: groups.length > 0 ? joinGroupDiffs(groups) : first.source.diff,
        groups: groups.length > 0 ? groups : null,
        isLoading: false,
      },
    ];
  });
}

export function buildReviewSectionItems(input: {
  readonly checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>;
  readonly gitPreviews: ReadonlyArray<ReviewGitPreview>;
  readonly turnDiffById: Readonly<Record<string, ReviewTurnDiff | undefined>>;
  readonly loadingTurnIds: Readonly<Record<string, boolean | undefined>>;
  readonly loadingGitSections: boolean;
}): ReadonlyArray<ReviewSectionItem> {
  const turnItems = getReadyReviewCheckpoints(input.checkpoints).map<ReviewSectionItem>(
    (checkpoint) => {
      const id = getReviewSectionIdForCheckpoint(checkpoint);
      const turnDiff = input.turnDiffById[id];
      return {
        id,
        kind: "turn",
        title: checkpointTitle(checkpoint),
        subtitle: checkpointSubtitle(checkpoint),
        diff: turnDiff?.diff ?? null,
        groups: turnDiff?.groups ?? null,
        isLoading: input.loadingTurnIds[id] === true,
      };
    },
  );

  const gitItems = buildGitSectionItems(input.gitPreviews);
  const hasDirtyWorktreeItem = gitItems.some((item) => item.id === DIRTY_WORKTREE_SECTION_ID);
  const visibleGitItems =
    input.loadingGitSections && !hasDirtyWorktreeItem
      ? [
          {
            id: DIRTY_WORKTREE_SECTION_ID,
            kind: "working-tree",
            title: DIRTY_WORKTREE_TITLE,
            subtitle: DIRTY_WORKTREE_SUBTITLE,
            diff: null,
            groups: null,
            isLoading: true,
          } satisfies ReviewSectionItem,
          ...gitItems,
        ]
      : gitItems;

  return [...turnItems, ...visibleGitItems];
}

export function getDefaultReviewSectionId(
  sections: ReadonlyArray<ReviewSectionItem>,
): string | null {
  return sections[0]?.id ?? null;
}

/**
 * Parses a section's diff for rendering. With `groups` (a multi-repo thread),
 * each repo's patch is parsed on its own so files come out in repo order and
 * carry their repo label; the flat `diff` still drives emptiness, truncation
 * and the raw fallback.
 */
export function buildReviewParsedDiff(
  diff: string | null | undefined,
  cacheScope: string,
  groups: ReadonlyArray<ReviewDiffGroup> | null = null,
): ReviewParsedDiff {
  const normalized = diff?.trim();
  if (!normalized) {
    return { kind: "empty" };
  }

  const { text, truncated } = splitTruncationMarker(normalized);
  if (text.length === 0) {
    return { kind: "empty" };
  }

  const notice = truncated
    ? "Diff output hit the server size cap. Showing the available excerpt."
    : null;

  try {
    const files =
      groups !== null && groups.length > 0
        ? groups.flatMap((group) => {
            const groupText = splitTruncationMarker(group.diff.trim()).text;
            return groupText.length === 0
              ? []
              : parseRenderableFiles(
                  groupText,
                  `${cacheScope}:${group.repoRoot}`,
                  group.displayName,
                );
          })
        : parseRenderableFiles(text, cacheScope, null);

    if (files.length === 0) {
      return {
        kind: "raw",
        text,
        reason: truncated
          ? "Diff was truncated before it could be parsed completely. Showing the raw excerpt."
          : "Unsupported diff format. Showing raw patch.",
        notice,
      };
    }

    return {
      kind: "files",
      files,
      fileCount: files.length,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      notice,
    };
  } catch {
    return {
      kind: "raw",
      text,
      reason: truncated
        ? "Diff was truncated before it could be parsed completely. Showing the raw excerpt."
        : "Failed to parse patch. Showing raw patch.",
      notice,
    };
  }
}
