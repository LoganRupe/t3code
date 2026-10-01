import type {
  FilesystemReadWorkspaceFileFolder,
  OrchestrationThreadWorktree,
} from "@t3tools/contracts";

/** A folder the files panel and @-mention search span, and the name it shows under. */
export interface ProjectFileRoot {
  readonly root: string;
  readonly label: string;
}

/**
 * Roots the files panel and @-mention search span, or null to use the single
 * project or worktree cwd. A `.code-workspace` project spans every folder the
 * file lists that exists on disk, git or not, so plain folders show up and
 * unlisted siblings of the file don't. Until the file has been read, or for
 * other projects, the roots are the multi-repo `repoRoots`. A repo root an
 * isolated run covers is swapped for its worktree but keeps the repo's label,
 * since a worktree's own folder is named for its branch.
 */
export function resolveProjectFileRoots(input: {
  readonly workspaceFolders: ReadonlyArray<
    Pick<FilesystemReadWorkspaceFileFolder, "absolutePath" | "exists">
  > | null;
  readonly repoRoots: ReadonlyArray<string> | undefined;
  readonly worktrees: ReadonlyArray<OrchestrationThreadWorktree> | undefined;
}): ProjectFileRoot[] | null {
  const roots = input.workspaceFolders
    ? input.workspaceFolders.filter((folder) => folder.exists).map((folder) => folder.absolutePath)
    : (input.repoRoots ?? []);
  if (roots.length < 2) return null;
  const labels = buildRootLabels(roots);
  return roots.map((root) => ({
    root: input.worktrees?.find((worktree) => worktree.repoRoot === root)?.worktreePath ?? root,
    label: labels.get(root) ?? root,
  }));
}

/** Stable string identity for a root list, for memo and component keys. */
export function projectFileRootsKey(roots: readonly ProjectFileRoot[] | undefined | null): string {
  return roots?.map(({ label, root }) => `${label}\0${root}`).join("\0\0") ?? "";
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
