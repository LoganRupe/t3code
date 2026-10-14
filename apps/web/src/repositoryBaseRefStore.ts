/**
 * Base refs a user picked per repository for a multi-repo thread's next isolated run, keyed
 * by scoped thread key then the repository's `relativePath`. Only explicit picks live here; a
 * repository without one starts from its default branch, which the server resolves. In memory
 * on purpose: a pick only matters until the run starts.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId, VcsRepository } from "@t3tools/contracts";
import { create } from "zustand";

interface RepositoryBaseRefStore {
  readonly byThread: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** A null `baseRef` clears the pick, returning the repository to its default branch. */
  readonly setBaseRef: (threadKey: string, relativePath: string, baseRef: string | null) => void;
}

export const useRepositoryBaseRefStore = create<RepositoryBaseRefStore>((set) => ({
  byThread: {},
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
}));

/**
 * The picks a thread holds for `repositories`, spread into `prepareWorktree` when a send
 * creates an isolated run. Empty when there are none.
 */
export function repositoryBaseRefsForSend(
  thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId },
  repositories: ReadonlyArray<VcsRepository>,
): {
  repositoryBaseRefs?: ReadonlyArray<{ readonly relativePath: string; readonly baseRef: string }>;
} {
  const picks =
    useRepositoryBaseRefStore.getState().byThread[
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
    ] ?? {};
  const repositoryBaseRefs = repositories.flatMap((repository) => {
    const baseRef = picks[repository.relativePath];
    return baseRef ? [{ relativePath: repository.relativePath, baseRef }] : [];
  });
  return repositoryBaseRefs.length > 0 ? { repositoryBaseRefs } : {};
}
