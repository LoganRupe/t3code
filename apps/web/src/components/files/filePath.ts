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

/** Label for a root, tolerating the server's normalized form (no trailing separator). */
export function labelForRoot(
  labels: ReadonlyMap<string, string>,
  root: string,
): string | undefined {
  const exact = labels.get(root);
  if (exact !== undefined) return exact;
  const trimmed = root.replace(/[\\/]+$/, "");
  for (const [candidate, label] of labels) {
    if (candidate.replace(/[\\/]+$/, "") === trimmed) return label;
  }
  return undefined;
}

/**
 * Assign each repo root a unique, human-readable label for the tree's top-level
 * grouping. Prefer the folder basename (matching the per-repo git controls);
 * when two roots share a basename, grow the label by parent segments until the
 * labels are distinct.
 */
export function buildRootLabels(roots: readonly string[]): Map<string, string> {
  const segments = new Map<string, string[]>();
  for (const root of roots) {
    segments.set(
      root,
      root
        .replaceAll("\\", "/")
        .replace(/\/+$/, "")
        .split("/")
        .filter((segment) => segment.length > 0),
    );
  }

  const labels = new Map<string, string>();
  for (const root of roots) {
    const parts = segments.get(root) ?? [];
    let depth = 1;
    let label = parts.slice(-depth).join("/") || root;
    const collidesAtDepth = () =>
      roots.some(
        (other) => other !== root && (segments.get(other) ?? []).slice(-depth).join("/") === label,
      );
    while (collidesAtDepth() && depth < parts.length) {
      depth += 1;
      label = parts.slice(-depth).join("/");
    }
    labels.set(root, label);
  }
  return labels;
}
