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
 * labels are distinct. Labels double as slash-delimited tree paths, so no label
 * may be a path prefix of another either: `api` beside `api/docs` would put the
 * second root where the first root's own `docs` folder belongs.
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

  const unique = [...segments.keys()];
  const depths = new Map(unique.map((root) => [root, 1]));
  const labelOf = (root: string) => {
    const parts = segments.get(root) ?? [];
    return parts.slice(-(depths.get(root) ?? 1)).join("/") || root;
  };
  const canGrow = (root: string) => (depths.get(root) ?? 1) < (segments.get(root)?.length ?? 0);

  // Each pass grows every root that collides with this pass's labels, so the
  // result does not depend on root order. Labels stop at the full path.
  for (;;) {
    const labels = new Map(unique.map((root) => [root, labelOf(root)]));
    const growing = new Set<string>();
    for (const [root, label] of labels) {
      for (const [other, otherLabel] of labels) {
        if (other === root) continue;
        if (label === otherLabel && canGrow(root)) growing.add(root);
        if (otherLabel.startsWith(`${label}/`)) growing.add(canGrow(root) ? root : other);
      }
    }
    const grown = [...growing].filter(canGrow);
    if (grown.length === 0) break;
    for (const root of grown) depths.set(root, (depths.get(root) ?? 1) + 1);
  }
  return new Map(roots.map((root) => [root, labelOf(root)]));
}
