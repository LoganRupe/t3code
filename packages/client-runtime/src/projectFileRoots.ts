import type { ProjectEntry, ProjectSearchEntriesResult, WorkspaceFolder } from "@t3tools/contracts";
import {
  isAbsolutePath,
  isWindowsAbsolutePath,
  resolveWorkspaceFilePath,
  workspaceRelativeFilePath,
} from "@t3tools/shared/path";

/** A folder the files panel and @ search span, and the label it shows under. */
export interface ProjectFileRoot {
  readonly label: string;
  readonly path: string;
}

/** A file or folder located inside one of the roots. */
export interface ProjectFileRootTarget {
  readonly root: ProjectFileRoot;
  /** Path inside the root with `/` separators; "" for the root itself. */
  readonly relativePath: string;
}

/**
 * The roots a project's file surfaces span. A `.code-workspace` project spans every folder the
 * file lists that exists on disk, git or not, named the way the file names them; any other
 * project is its folder alone, named after the project. Labels double as tree path segments, so
 * same-named folders grow parent segments until they differ.
 */
export function projectFileRoots(input: {
  readonly cwd: string;
  readonly projectName?: string | undefined;
  readonly folders: ReadonlyArray<WorkspaceFolder> | undefined;
}): ReadonlyArray<ProjectFileRoot> {
  const folders = input.folders ?? [];
  if (folders.length === 0) {
    return [{ label: input.projectName || basenameOf(input.cwd) || input.cwd, path: input.cwd }];
  }
  const labels = buildRootLabels(folders);
  return folders.map((folder, index) => ({ label: labels[index]!, path: folder.path }));
}

/** Stable identity for a root list, for memo and component keys. */
export function projectFileRootsKey(roots: ReadonlyArray<ProjectFileRoot>): string {
  return roots.map((root) => `${root.label}\0${root.path}`).join("\0\0");
}

/**
 * Whether the tree shows a node per root. A single root, even one that is not the project
 * folder, lists its entries at the top level the way an ordinary project does.
 */
export function hasSeveralFileRoots(roots: ReadonlyArray<ProjectFileRoot>): boolean {
  return roots.length > 1;
}

/** The tree path of an entry: under its root's label when the tree has several roots. */
export function fileRootTreePath(
  roots: ReadonlyArray<ProjectFileRoot>,
  target: ProjectFileRootTarget,
): string {
  if (!hasSeveralFileRoots(roots)) return target.relativePath;
  return target.relativePath === ""
    ? target.root.label
    : `${target.root.label}/${target.relativePath}`;
}

/**
 * The root a tree path belongs to and the path inside it. Null for a segment above every root,
 * which only groups same-named roots (`team-a` over `team-a/docs`).
 */
export function fileRootFromTreePath(
  roots: ReadonlyArray<ProjectFileRoot>,
  treePath: string,
): ProjectFileRootTarget | null {
  const path = treePath.replace(/\/+$/, "");
  if (!hasSeveralFileRoots(roots)) {
    const root = roots[0];
    return root === undefined ? null : { root, relativePath: path };
  }
  let match: ProjectFileRootTarget | null = null;
  for (const root of roots) {
    if (path !== root.label && !path.startsWith(`${root.label}/`)) continue;
    if (match === null || root.label.length > match.root.label.length) {
      match = { root, relativePath: path.slice(root.label.length).replace(/^\//, "") };
    }
  }
  return match;
}

/**
 * Merges one search result per root into a single listing of tree paths. Results interleave
 * round-robin, since ranks do not compare across indexes, and stop at `limit` so the payload
 * stays the size of one search; anything left over marks the listing truncated.
 */
export function mergeRootSearchResults(
  roots: ReadonlyArray<ProjectFileRoot>,
  results: ReadonlyArray<ProjectSearchEntriesResult>,
  limit: number,
): ProjectSearchEntriesResult {
  const entries: ProjectEntry[] = [];
  const width = Math.max(...results.map((result) => result.entries.length), 0);
  for (let index = 0; index < width && entries.length < limit; index++) {
    results.forEach((result, rootIndex) => {
      const entry = result.entries[index];
      const root = roots[rootIndex];
      if (entry === undefined || root === undefined || entries.length >= limit) return;
      entries.push({
        ...entry,
        path: fileRootTreePath(roots, { root, relativePath: entry.path }),
      });
    });
  }
  return {
    entries,
    truncated:
      results.some((result) => result.truncated) ||
      results.reduce((total, result) => total + result.entries.length, 0) > entries.length,
  };
}

/**
 * The root that holds a path, with the path inside it. `path` is absolute, or relative to
 * `cwd`, the way chat links and the files surface name files. The innermost root wins when
 * roots nest. Null when no root holds the path.
 */
export function fileRootForPath(
  roots: ReadonlyArray<ProjectFileRoot>,
  cwd: string,
  path: string,
): ProjectFileRootTarget | null {
  const absolute = isAbsolutePath(path) ? path : resolveWorkspaceFilePath(path, cwd);
  let match: ProjectFileRootTarget | null = null;
  for (const root of roots) {
    const relativePath = workspaceRelativeFilePath(absolute, root.path);
    if (relativePath === null) continue;
    if (match === null || root.path.length > match.root.path.length) {
      match = { root, relativePath: relativePath === "." ? "" : relativePath };
    }
  }
  return match;
}

/**
 * How a file in a root is named to the rest of the app: relative to `cwd` when its root is the
 * project folder, the way an ordinary project names files, and absolute otherwise, so a file in
 * a listed folder elsewhere opens and is mentioned without ambiguity.
 */
export function fileRootOpenPath(cwd: string, target: ProjectFileRootTarget): string {
  if (workspaceRelativeFilePath(target.root.path, cwd) === ".") {
    return target.relativePath === "" ? "." : target.relativePath;
  }
  return target.relativePath === ""
    ? target.root.path
    : resolveWorkspaceFilePath(target.relativePath, target.root.path);
}

/**
 * Assign each root a unique label for the tree's top level. The folder's name from the
 * workspace file comes first; when two roots share one, the label grows by parent segments of
 * the folder's path until the labels differ. Labels double as slash-delimited tree paths, so
 * no label may be a path prefix of another either: `api` beside `api/docs` would put the second
 * root where the first root's own `docs` folder belongs.
 */
export function buildRootLabels(
  roots: ReadonlyArray<Pick<WorkspaceFolder, "name" | "path">>,
): ReadonlyArray<string> {
  const segments = roots.map((root) => [
    ...root.path
      .replaceAll("\\", "/")
      .replace(/\/+$/, "")
      .split("/")
      .filter((segment) => segment.length > 0)
      .slice(0, -1),
    root.name.replaceAll(/[\\/]+/g, "-"),
  ]);
  const depths = roots.map(() => 1);
  const labelOf = (index: number) => segments[index]!.slice(-depths[index]!).join("/");
  const canGrow = (index: number) => depths[index]! < segments[index]!.length;

  // Each pass grows every root that collides with this pass's labels, so the result does not
  // depend on root order. Labels stop at the full path.
  for (;;) {
    const labels = roots.map((_, index) => labelOf(index));
    const growing = new Set<number>();
    labels.forEach((label, index) => {
      labels.forEach((otherLabel, otherIndex) => {
        if (otherIndex === index) return;
        if (label === otherLabel && canGrow(index)) growing.add(index);
        if (otherLabel.startsWith(`${label}/`)) growing.add(canGrow(index) ? index : otherIndex);
      });
    });
    const grown = [...growing].filter(canGrow);
    if (grown.length === 0) break;
    for (const index of grown) depths[index]! += 1;
  }
  return roots.map((_, index) => labelOf(index));
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const separator = isWindowsAbsolutePath(trimmed) ? /[\\/]/ : /\//;
  return trimmed.split(separator).at(-1) ?? "";
}
