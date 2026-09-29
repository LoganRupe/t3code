import type {
  FilesystemReadWorkspaceFileFolder,
  OrchestrationThreadWorktree,
} from "@t3tools/contracts";

/**
 * Roots the files panel and @-mention search span, or null to use the single
 * project or worktree cwd. A `.code-workspace` project spans every folder the
 * file lists that exists on disk, git or not, so plain folders show up and
 * unlisted siblings of the file don't. Until the file has been read, or for
 * other projects, the roots are the multi-repo `repoRoots`. A repo root an
 * isolated run covers is swapped for its worktree.
 */
export function resolveProjectFileRoots(input: {
  readonly workspaceFolders: ReadonlyArray<
    Pick<FilesystemReadWorkspaceFileFolder, "absolutePath" | "exists">
  > | null;
  readonly repoRoots: ReadonlyArray<string> | undefined;
  readonly worktrees: ReadonlyArray<OrchestrationThreadWorktree> | undefined;
}): string[] | null {
  const roots = input.workspaceFolders
    ? input.workspaceFolders.filter((folder) => folder.exists).map((folder) => folder.absolutePath)
    : (input.repoRoots ?? []);
  if (roots.length < 2) return null;
  return roots.map(
    (root) => input.worktrees?.find((worktree) => worktree.repoRoot === root)?.worktreePath ?? root,
  );
}
