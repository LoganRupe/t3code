import type { FileDiffMetadata } from "@pierre/diffs";
import type { FileTreeBatchOperation, FileTreeSortComparator, GitStatus } from "@pierre/trees";

import { resolveFileDiffPath } from "~/lib/diffRendering";

/** One changed file as the tree shows it: its current path and how it changed. */
export interface DiffFileTreeEntry {
  readonly path: string;
  readonly status: GitStatus;
}

function toGitStatus(file: FileDiffMetadata): GitStatus {
  switch (file.type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
      return "modified";
  }
}

/**
 * Maps parsed diff files to tree entries, keeping the diff's own order. A path
 * appears once: a type change (regular file to symlink) is a deletion plus an
 * addition of the same path, and the tree shows the surviving file as modified.
 */
export function diffFileTreeEntries(
  files: ReadonlyArray<FileDiffMetadata>,
): ReadonlyArray<DiffFileTreeEntry> {
  const entries: DiffFileTreeEntry[] = [];
  appendDiffFileTreeEntries(entries, new Map(), files, "");
  return entries;
}

/**
 * Appends `files` under `pathPrefix`, collapsing a repeated path onto its first entry.
 * Pierre's path store throws on a duplicate, and a type change (regular file to symlink)
 * arrives as a deletion plus an addition of the same path, so the surviving row reads
 * `modified` when the two statuses disagree.
 */
function appendDiffFileTreeEntries(
  entries: DiffFileTreeEntry[],
  indexByPath: Map<string, number>,
  files: ReadonlyArray<FileDiffMetadata>,
  pathPrefix: string,
): void {
  for (const file of files) {
    const path = `${pathPrefix}${resolveFileDiffPath(file)}`;
    const status = toGitStatus(file);
    const existing = indexByPath.get(path);
    if (existing === undefined) {
      indexByPath.set(path, entries.length);
      entries.push({ path, status });
      continue;
    }
    if (entries[existing]!.status !== status) entries[existing] = { path, status: "modified" };
  }
}

/** A group of changed files under one repo root of a multi-repo diff. */
export interface DiffFileTreeGroup {
  /** Folder name the group's files sit under in the tree, matching the diff's section header. */
  readonly label: string;
  readonly files: ReadonlyArray<FileDiffMetadata>;
}

/**
 * Tree entries for a diff that spans several repo roots. Each root's files sit under a folder
 * named for that root, so two roots that both changed `README.md` stay two rows, the same way
 * the diff draws one section per root.
 */
export function groupedDiffFileTreeEntries(
  groups: ReadonlyArray<DiffFileTreeGroup>,
): ReadonlyArray<DiffFileTreeEntry> {
  const entries: DiffFileTreeEntry[] = [];
  const indexByPath = new Map<string, number>();
  for (const group of groups) {
    appendDiffFileTreeEntries(entries, indexByPath, group.files, `${group.label}/`);
  }
  return entries;
}

/** The tree path a repo-relative file takes inside a grouped tree, or null when no group has it. */
export function groupedDiffFileTreePath(
  groups: ReadonlyArray<DiffFileTreeGroup>,
  filePath: string,
): string | null {
  const group = groups.find((candidate) =>
    candidate.files.some((file) => resolveFileDiffPath(file) === filePath),
  );
  return group ? `${group.label}/${filePath}` : null;
}

/**
 * Every directory on the way to each file, registered with the trailing slash Pierre uses for
 * directory ids. Parents come before children so the tree can add them in order.
 */
export function collectDirectoryPaths(paths: ReadonlyArray<string>): ReadonlyArray<string> {
  const directories = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    let directory = "";
    for (const segment of segments.slice(0, -1)) {
      directory += `${segment}/`;
      directories.add(directory);
    }
  }
  return [...directories];
}

/** A folder takes the position of its first file in the diff. */
export function diffFileTreePositions(paths: ReadonlyArray<string>): ReadonlyMap<string, number> {
  const positions = new Map<string, number>();
  paths.forEach((path, index) => {
    positions.set(path, index);
    let directory = "";
    for (const segment of path.split("/").slice(0, -1)) {
      directory += `${segment}/`;
      if (!positions.has(directory)) positions.set(directory, index);
    }
  });
  return positions;
}

export function compareDiffFileTreeEntries(
  getPositions: () => ReadonlyMap<string, number>,
): FileTreeSortComparator {
  return (left, right) => {
    const positions = getPositions();
    return (
      (positions.get(left.path) ?? Number.MAX_SAFE_INTEGER) -
        (positions.get(right.path) ?? Number.MAX_SAFE_INTEGER) ||
      left.depth - right.depth ||
      left.path.localeCompare(right.path)
    );
  };
}

function pathDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

/**
 * The adds and removes that turn one set of file paths into another, so a diff that changes
 * under the reader (a new slice, a refresh after an agent edit) keeps the directories they
 * have already opened or closed instead of rebuilding the tree from scratch.
 *
 * Directories are removed only once no file needs them; a directory that gains its first file
 * is added before that file.
 */
export function buildDiffFileTreeUpdates(
  previousPaths: ReadonlyArray<string>,
  nextPaths: ReadonlyArray<string>,
): FileTreeBatchOperation[] {
  const previousDirectories = new Set(collectDirectoryPaths(previousPaths));
  const nextDirectories = new Set(collectDirectoryPaths(nextPaths));
  const previous = new Set(previousPaths);
  const next = new Set(nextPaths);
  const updates: FileTreeBatchOperation[] = [];

  for (const path of previousPaths) {
    if (!next.has(path)) updates.push({ type: "remove", path });
  }
  // Deepest first: a directory can only go once everything under it has.
  const removedDirectories = [...previousDirectories]
    .filter((directory) => !nextDirectories.has(directory))
    .toSorted((left, right) => pathDepth(right) - pathDepth(left));
  for (const directory of removedDirectories) {
    updates.push({ type: "remove", path: directory, recursive: true });
  }

  // Shallowest first: a file's directory has to exist before the file does.
  const addedDirectories = [...nextDirectories]
    .filter((directory) => !previousDirectories.has(directory))
    .toSorted((left, right) => pathDepth(left) - pathDepth(right));
  for (const directory of addedDirectories) updates.push({ type: "add", path: directory });
  for (const path of nextPaths) {
    if (!previous.has(path)) updates.push({ type: "add", path });
  }

  return updates;
}
