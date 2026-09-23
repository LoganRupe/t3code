/**
 * Per-repo base branches a user picked for a multi-repo thread's next isolated
 * run, keyed by scoped thread key then repo root. Only explicit picks live
 * here; roots without one base on their own default branch, which the server
 * resolves. In-memory on purpose: a pick only matters until the run starts.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

interface RepoBaseBranchStore {
  readonly byThread: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly setBase: (threadKey: string, repoRoot: string, baseBranch: string) => void;
}

export const useRepoBaseBranchStore = create<RepoBaseBranchStore>((set) => ({
  byThread: {},
  setBase: (threadKey, repoRoot, baseBranch) =>
    set((state) => ({
      byThread: {
        ...state.byThread,
        [threadKey]: { ...state.byThread[threadKey], [repoRoot]: baseBranch },
      },
    })),
}));

/**
 * The picks a thread holds for `repoRoots`, spread into `prepareWorktree` when
 * a send creates an isolated run. Empty when there are none.
 */
export function repoBaseBranchesForSend(
  thread: { readonly environmentId: EnvironmentId; readonly id: ThreadId },
  repoRoots: ReadonlyArray<string> | undefined,
): { repoBaseBranches?: ReadonlyArray<{ repoRoot: string; baseBranch: string }> } {
  const picks =
    useRepoBaseBranchStore.getState().byThread[
      scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))
    ] ?? {};
  const repoBaseBranches = (repoRoots ?? []).flatMap((repoRoot) => {
    const baseBranch = picks[repoRoot];
    return baseBranch ? [{ repoRoot, baseBranch }] : [];
  });
  return repoBaseBranches.length > 0 ? { repoBaseBranches } : {};
}
