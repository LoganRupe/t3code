/**
 * Pure decisions behind the diff panel's repo targeting. The panel diffs one
 * cwd for a single-repo thread and fans out over several for a multi-repo
 * workspace; both of those choices live here so they can be tested without
 * rendering the panel.
 */

export interface DiffRepoTarget {
  /** The repo the section belongs to, used for labels and open-in-editor. */
  readonly repoRoot: string;
  /** Where to run the diff: a worktree for isolated runs, else the repo itself. */
  readonly cwd: string;
}

/**
 * The repo roots the branch/working diff fans out over, each paired with the cwd
 * to diff it in. Isolated runs create one worktree per repo, so diff those. A
 * non-isolated multi-repo `.code-workspace` has no worktrees and a container
 * `workspaceRoot` that isn't itself a git repo, so diff each repo root directly
 * (mirrors ChatView's per-repo git status). Empty for a single-repo thread,
 * which the panel diffs with one cwd instead.
 */
export function resolveDiffRepoTargets(input: {
  readonly threadWorktrees: ReadonlyArray<{
    readonly repoRoot: string;
    readonly worktreePath: string;
  }>;
  readonly repoRoots: ReadonlyArray<string> | undefined;
}): ReadonlyArray<DiffRepoTarget> {
  const worktrees = input.threadWorktrees.filter((entry) => entry.worktreePath.length > 0);
  if (worktrees.length > 0) {
    return worktrees.map((entry) => ({ repoRoot: entry.repoRoot, cwd: entry.worktreePath }));
  }
  const repoRoots = input.repoRoots ?? [];
  if (repoRoots.length > 1) {
    return repoRoots.map((repoRoot) => ({ repoRoot, cwd: repoRoot }));
  }
  return [];
}

/**
 * Whether the panel has any git repo to show diffs for.
 *
 * The status probe runs in a single cwd, which for a workspace-file project is
 * the anchor directory holding the `.code-workspace` and often not a repo at
 * all. Every entry in `diffRepoTargets` is a repo by construction, so their
 * presence outranks the probe: without this a multi-repo workspace reported
 * "not a git repository" and never asked the server for its turn diffs.
 */
export function resolveDiffPanelIsGitRepo(input: {
  readonly diffRepoTargetCount: number;
  /** Undefined while the probe is still in flight; assume a repo until it answers. */
  readonly probedIsRepo: boolean | undefined;
}): boolean {
  return input.diffRepoTargetCount > 0 || (input.probedIsRepo ?? true);
}
