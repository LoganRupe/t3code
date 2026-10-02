import type { ProjectEntry } from "@t3tools/contracts";
import { isWindowsAbsolutePath } from "@t3tools/shared/path";

import { isAbsolutePath } from "~/terminal-links";

export interface FileBreadcrumb {
  label: string;
  path: string;
  kind: "project" | "directory" | "file";
}

export interface FileBreadcrumbChild extends ProjectEntry {
  label: string;
}

/**
 * Crumbs for a workspace-relative path start at the project. An absolute host
 * path is outside the workspace, so its crumbs start at the filesystem root.
 */
export function fileBreadcrumbs(projectName: string, relativePath: string): FileBreadcrumb[] {
  const hostPath = isAbsolutePath(relativePath);
  const separator = isWindowsAbsolutePath(relativePath) ? "\\" : "/";
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  const root = relativePath.startsWith("\\\\") ? "\\\\" : hostPath && separator === "/" ? "/" : "";
  return [
    ...(hostPath ? [] : [{ label: projectName, path: "", kind: "project" as const }]),
    ...parts.map((part, index) => ({
      label: part,
      path: root + parts.slice(0, index + 1).join(separator),
      kind: index === parts.length - 1 ? ("file" as const) : ("directory" as const),
    })),
  ];
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

/** Whether `path` is one of `roots`, tolerating a trailing separator on either. */
export function isRootPath(roots: readonly string[] | undefined, path: string): boolean {
  const trimmed = path.replace(/[\\/]+$/, "");
  return roots?.some((root) => root.replace(/[\\/]+$/, "") === trimmed) ?? false;
}

/**
 * What a files tree entry's right-click actions act on. In a multi-root tree an
 * entry's tree path starts with its root's label, which only names a real path
 * when the root sits directly in `cwd` under that name, so a rooted entry
 * resolves through its root instead. A root's own node (`relativePath` "") is
 * named from its parent folder, since the file actions take a relative path.
 */
export function fileTreeEntryTarget(input: {
  readonly treePath: string;
  readonly cwd: string;
  readonly root: string | undefined;
  readonly relativePath: string | undefined;
}) {
  if (input.root === undefined || input.relativePath === undefined) {
    return { workspaceRoot: input.cwd, filePath: input.treePath, mentionPath: input.treePath };
  }
  const root = input.root.replace(/[\\/]+$/, "");
  if (input.relativePath === "") {
    const separatorIndex = Math.max(root.lastIndexOf("/"), root.lastIndexOf("\\"));
    return {
      workspaceRoot: root.slice(0, separatorIndex) || root.slice(0, separatorIndex + 1),
      filePath: root.slice(separatorIndex + 1),
      mentionPath: root,
    };
  }
  return {
    workspaceRoot: root,
    filePath: input.relativePath,
    mentionPath: `${root}/${input.relativePath}`,
  };
}
