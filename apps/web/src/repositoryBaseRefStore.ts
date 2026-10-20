/**
 * Choices a user made per repository for a multi-repo thread's next isolated run, keyed by
 * scoped thread key then the repository's `relativePath`: a base ref, and which repositories
 * get a worktree. Only explicit choices live here; without them a repository starts from its
 * default branch, and the default set of worktrees applies. In memory on purpose: a choice only
 * matters until the run starts.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  worktreeRepositoriesFor,
  worktreeRepositoriesForSend,
  withWorktreeRepository,
} from "@t3tools/client-runtime/repository-base-refs";
import type { EnvironmentId, ThreadId, VcsRepository } from "@t3tools/contracts";
import { create } from "zustand";

interface RepositoryBaseRefStore {
  readonly byThread: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Repositories picked for a worktree; a thread without an entry has the default set. */
  readonly worktreesByThread: Readonly<Record<string, ReadonlyArray<string>>>;
  /** A null `baseRef` clears the pick, returning the repository to its default branch. */
  readonly setBaseRef: (threadKey: string, relativePath: string, baseRef: string | null) => void;
  /** Gives one repository a worktree in the next run, or takes it away, starting from `current`. */
  readonly setWorktree: (
    threadKey: string,
    current: ReadonlyArray<string>,
    relativePath: string,
    included: boolean,
  ) => void;
}

export const useRepositoryBaseRefStore = create<RepositoryBaseRefStore>((set) => ({
  byThread: {},
  worktreesByThread: {},
  setBaseRef: (threadKey, relativePath, baseRef) =>
    set((state) => {
      const { [relativePath]: _cleared, ...rest } = state.byThread[threadKey] ?? {};
      return {
        byThread: {
          ...state.byThread,
          [threadKey]: baseRef === null ? rest : { ...rest, [relativePath]: baseRef },
        },
      };
    }),
  setWorktree: (threadKey, current, relativePath, included) =>
    set((state) => ({
      worktreesByThread: {
        ...state.worktreesByThread,
        [threadKey]: withWorktreeRepository(current, relativePath, included),
      },
    })),
}));

/** The repositories that get a worktree in a thread's next run, by `relativePath`. */
export function useWorktreeRepositories(
  threadKey: string,
  repositories: ReadonlyArray<VcsRepository>,
): ReadonlyArray<string> {
  const picks = useRepositoryBaseRefStore((store) => store.worktreesByThread[threadKey]);
  return worktreeRepositoriesFor(picks, repositories);
}

/** The worktree picks a thread holds, or undefined for the default set. */
export function worktreeRepositoryPicks(thread: {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
}): ReadonlyArray<string> | undefined {
  return useRepositoryBaseRefStore.getState().worktreesByThread[
    scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
  ];
}

/**
 * The picks a thread holds for `repositories`, spread into `prepareWorktree` when a send
 * creates an isolated run: base refs for the repositories that get a worktree, and which ones
 * do when that is not all of them. Empty when there are none.
 */
export function repositoryBaseRefsForSend(
  thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId },
  repositories: ReadonlyArray<VcsRepository>,
): {
  repositoryBaseRefs?: ReadonlyArray<{ readonly relativePath: string; readonly baseRef: string }>;
  repositories?: ReadonlyArray<string>;
} {
  const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
  const state = useRepositoryBaseRefStore.getState();
  const picks = state.byThread[threadKey] ?? {};
  const worktreePicks = state.worktreesByThread[threadKey];
  const selected = worktreeRepositoriesForSend(worktreePicks, repositories);
  const repositoryBaseRefs = repositories.flatMap((repository) => {
    const baseRef = picks[repository.relativePath];
    if (!baseRef) return [];
    if (
      selected !== undefined &&
      repository.relativePath !== "." &&
      !selected.includes(repository.relativePath)
    ) {
      return [];
    }
    return [{ relativePath: repository.relativePath, baseRef }];
  });
  return {
    ...(repositoryBaseRefs.length > 0 ? { repositoryBaseRefs } : {}),
    ...(selected === undefined ? {} : { repositories: selected }),
  };
}
