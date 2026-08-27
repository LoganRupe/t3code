/**
 * Pure decisions behind the diff panel, kept out of the component so they can
 * be tested without rendering it. Repo targeting for multi-repo threads is
 * shared with mobile: `resolveDiffRepoTargets` in `@t3tools/client-runtime`.
 */

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
