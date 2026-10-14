import type { ProjectEntry } from "@t3tools/contracts";
import {
  fileRootFromTreePath,
  fileRootOpenPath,
  hasSeveralFileRoots,
  type ProjectFileRoot,
} from "@t3tools/client-runtime/project-file-roots";
import { isWindowsAbsolutePath, isHostPath } from "@t3tools/shared/path";

export interface FileBreadcrumb {
  label: string;
  path: string;
  kind: "project" | "directory" | "file";
}

export interface FileBreadcrumbChild extends ProjectEntry {
  label: string;
}

export function fileBreadcrumbs(projectName: string, relativePath: string): FileBreadcrumb[] {
  const hostPath = isHostPath(relativePath);
  const separator = isWindowsAbsolutePath(relativePath) ? "\\" : "/";
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  const root = relativePath.startsWith("\\\\") ? "\\\\" : relativePath.startsWith("/") ? "/" : "";
  return [
    ...(hostPath ? [] : [{ label: projectName, path: "", kind: "project" as const }]),
    ...parts.map((part, index) => {
      const path = root + parts.slice(0, index + 1).join(separator);
      return {
        label: part,
        // A bare drive (`C:`) means the drive's current directory; its root is `C:\`.
        path: /^[A-Za-z]:$/.test(path) ? `${path}\\` : path,
        kind: index === parts.length - 1 ? ("file" as const) : ("directory" as const),
      };
    }),
  ];
}

/**
 * `relativePath` written the way its own crumb names it, so a link with a
 * trailing or repeated separator still finds its crumb.
 */
export function breadcrumbPathOf(relativePath: string): string {
  return fileBreadcrumbs("", relativePath).at(-1)?.path ?? relativePath;
}

/**
 * Whether a host folder crumb names a directory the server can list. A UNC
 * server (`\\server`) is not one; its shares (`\\server\share`) are.
 */
export function isListableHostFolder(path: string): boolean {
  return isHostPath(path) && !/^\\\\[^\\/]+$/.test(path);
}

/** Index of `path`'s crumb among `trail`'s crumbs; -1 when the trail does not pass through it. */
function trailCrumbIndex(trail: string, path: string): number {
  const crumbPath = breadcrumbPathOf(path);
  return fileBreadcrumbs("", trail).findIndex((crumb) => crumb.path === crumbPath);
}

/**
 * The deepest path the breadcrumbs keep showing after the browser moves to `path`.
 * Going up keeps the folders below visible so the way back down is one click;
 * moving anywhere else starts over at `path`.
 */
export function retainedBreadcrumbTrail(trail: string | undefined, path: string): string {
  return trail !== undefined && trailCrumbIndex(trail, path) >= 0 ? trail : path;
}

/** The entry of `folder` that leads toward `trail`; null when the trail ends at the folder. */
export function trailChildOf(folder: string, trail: string): string | null {
  const index = trailCrumbIndex(trail, folder);
  return index < 0 ? null : (fileBreadcrumbs("", trail)[index + 1]?.label ?? null);
}

/**
 * A host path for `relativePath` (as a host folder's listing names it, with `/`)
 * inside host folder `folder`, using the folder's own separator.
 */
export function joinHostPath(folder: string, relativePath: string): string {
  const separator = isWindowsAbsolutePath(folder) ? "\\" : "/";
  const base = folder.endsWith(separator) ? folder : `${folder}${separator}`;
  return base + relativePath.split("/").join(separator);
}

export function fileBreadcrumbChildren(
  entries: readonly ProjectEntry[],
  directoryPath: string,
): FileBreadcrumbChild[] {
  let collator: Intl.Collator | undefined;
  const prefix = directoryPath ? `${directoryPath}/` : "";
  return entries
    .flatMap((entry) => {
      if (!entry.path.startsWith(prefix)) return [];
      const label = entry.path.slice(prefix.length);
      if (!label || label.includes("/")) return [];
      return [{ ...entry, label }];
    })
    .toSorted((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      collator ??= new Intl.Collator(undefined, {
        numeric: true,
        sensitivity: "base",
      });
      return collator.compare(left.label, right.label);
    });
}

export function fileBreadcrumbParent(directoryPath: string): string | null {
  if (!directoryPath) return null;
  const separatorIndex = directoryPath.lastIndexOf("/");
  return separatorIndex === -1 ? "" : directoryPath.slice(0, separatorIndex);
}

/** What a files tree row's actions act on. */
export interface FileTreeEntryTarget {
  /** The folder the file actions resolve `filePath` against. */
  readonly workspaceRoot: string;
  readonly filePath: string;
  /** The path a composer mention names the entry by. */
  readonly mentionPath: string;
  /** The path the files surface opens the entry by. */
  readonly openPath: string;
}

/**
 * Resolves a tree row through its root, so Reveal, Open, Open with, Copy mention and Add to chat
 * act on the real file rather than the label its tree path starts with. A root's own row is named
 * from its parent folder, since the file actions take a path relative to a folder. A row that only
 * groups same-named roots acts on the folder they share, or on nothing when they do not share one,
 * as with a drive (`C:`) or network host (`\\server`), which no parent folder can name.
 */
export function fileTreeEntryTarget(input: {
  readonly roots: ReadonlyArray<ProjectFileRoot>;
  readonly cwd: string;
  readonly treePath: string;
}): FileTreeEntryTarget | null {
  const treePath = input.treePath.replace(/\/+$/, "");
  const target = fileRootFromTreePath(input.roots, treePath);
  if (target === null) {
    const folder = rootGroupFolder(input.roots, treePath);
    return folder === null ? null : folderTarget(folder);
  }
  if (!hasSeveralFileRoots(input.roots) && target.root.path === input.cwd) {
    return {
      workspaceRoot: input.cwd,
      filePath: target.relativePath,
      mentionPath: target.relativePath,
      openPath: target.relativePath,
    };
  }
  if (target.relativePath === "") return folderTarget(target.root.path);
  return {
    workspaceRoot: target.root.path,
    filePath: target.relativePath,
    mentionPath: fileRootOpenPath(input.cwd, target),
    openPath: fileRootOpenPath(input.cwd, target),
  };
}

function folderTarget(folder: string): FileTreeEntryTarget | null {
  const trimmed = folder.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const parent = trimmed.slice(0, separatorIndex) || trimmed.slice(0, separatorIndex + 1);
  if (parent === "" || /^(?:[A-Za-z]:|[\\/]{2}[^\\/]+)$/.test(trimmed)) return null;
  return {
    workspaceRoot: parent,
    filePath: trimmed.slice(separatorIndex + 1),
    mentionPath: trimmed,
    openPath: trimmed,
  };
}

/**
 * The folder behind a row that only groups roots: when listed folders share a name their labels
 * grow parent segments (`team-a/docs`), and the tree shows `team-a` as a row of its own. Null
 * when the roots below it do not sit in one folder, as with an isolated run's worktree, whose
 * path does not end in its label.
 */
export function rootGroupFolder(
  roots: ReadonlyArray<ProjectFileRoot>,
  treePath: string,
): string | null {
  let folder: string | null = null;
  for (const root of roots) {
    if (!root.label.startsWith(`${treePath}/`)) continue;
    const trimmed = root.path.replace(/[\\/]+$/, "");
    const normalized = trimmed.replaceAll("\\", "/");
    if (!normalized.endsWith(`/${root.label}`)) return null;
    const candidate = trimmed.slice(0, trimmed.length - (root.label.length - treePath.length));
    if (folder !== null && folder !== candidate) return null;
    folder = candidate;
  }
  return folder;
}
