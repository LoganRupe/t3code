import type {
  FilesystemReadWorkspaceFileFolder,
  OrchestrationThreadWorktree,
} from "@t3tools/contracts";

import { buildRootLabels } from "../components/files/filePath";

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
