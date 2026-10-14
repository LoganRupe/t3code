import { resolveReviewRepository } from "@t3tools/client-runtime/state/review";

import {
  setReviewSelectedRepository,
  useReviewSelectedRepository,
} from "../features/review/reviewState";
import { scopedThreadKey } from "../lib/scopedEntities";
import { useSelectedThreadWorktree } from "./use-selected-thread-worktree";
import { useThreadSelection } from "./use-thread-selection";
import { useWorkspaceRepositories } from "./workspace-repositories";

/**
 * Where the selected thread's Git sheets act. A multi-repo workspace acts on the repository
 * picked in the Git or review sheet (the folder's own by default). As on web, only the folder's
 * own repository carries the thread's branch; the others are Git-only. An ordinary checkout
 * lists no repositories and keeps the thread's cwd. Files, terminals, and the agent always stay
 * on the thread's cwd.
 */
export function useSelectedThreadGitRepository() {
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  const { selectedThreadCwd, selectedThreadWorktreePath } = useSelectedThreadWorktree();
  const { repositories } = useWorkspaceRepositories({
    environmentId: selectedThread?.environmentId,
    cwd: selectedThreadCwd,
  });
  const threadKey = selectedThread
    ? scopedThreadKey(selectedThread.environmentId, selectedThread.id)
    : null;
  const selectedRelativePath = useReviewSelectedRepository(threadKey);
  const repository = resolveReviewRepository(repositories, selectedRelativePath);
  const selectRepository = (relativePath: string) => {
    if (threadKey) setReviewSelectedRepository(threadKey, relativePath);
  };
  const isThreadRepository = repository === null || repository.relativePath === ".";

  return {
    repositories,
    repository,
    selectRepository,
    gitCwd: repository?.path ?? selectedThreadCwd,
    /** Whether branch changes here are the thread's branch changes. */
    isThreadRepository,
    /** Worktrees share their repository's refs, so any checkout of it lists them. */
    branchListCwd: isThreadRepository
      ? (selectedThreadProject?.workspaceRoot ?? null)
      : repository.path,
    worktreePath:
      selectedThreadWorktreePath === null ? null : (repository?.path ?? selectedThreadWorktreePath),
  };
}
