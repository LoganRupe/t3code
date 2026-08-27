import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createReviewEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const diffFileScheduler = createAtomCommandScheduler();
  return {
    diffPreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:review:diff-preview",
      tag: WS_METHODS.reviewGetDiffPreview,
      staleTimeMs: 5_000,
    }),
    diffFileContents: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:review:diff-file-contents",
      tag: WS_METHODS.reviewGetDiffFileContents,
      scheduler: diffFileScheduler,
      concurrency: {
        mode: "singleFlight",
        key: ({ environmentId, input }) =>
          JSON.stringify([
            environmentId,
            input.cwd,
            input.sourceKind,
            input.baseRef,
            input.headRef,
            input.oldPath,
            input.newPath,
            input.changeType,
          ]),
      },
    }),
  };
}

export interface DiffRepoTarget {
  /** The repo the section belongs to, used for labels and open-in-editor. */
  readonly repoRoot: string;
  /** Where to run the diff: a worktree for isolated runs, else the repo itself. */
  readonly cwd: string;
}

/**
 * The repo roots a multi-repo branch/working diff fans out over, each paired
 * with the cwd to diff it in. Isolated runs create one worktree per repo, so
 * diff those. A non-isolated multi-repo `.code-workspace` has no worktrees and
 * a container `workspaceRoot` that isn't itself a git repo, so diff each repo
 * root directly. Empty for a single-repo thread, which clients diff with one
 * cwd instead.
 *
 * An isolated thread whose worktree map is empty (legacy rows, or a run whose
 * per-repo worktrees have not landed yet) still has its own `worktreePath`;
 * that thread must diff its worktree, never the project's checkouts, so it
 * never falls back to repo roots.
 */
export function resolveDiffRepoTargets(input: {
  readonly threadWorktrees: ReadonlyArray<{
    readonly repoRoot: string;
    readonly worktreePath: string;
  }>;
  readonly threadWorktreePath: string | null | undefined;
  readonly repoRoots: ReadonlyArray<string> | undefined;
}): ReadonlyArray<DiffRepoTarget> {
  const worktrees = input.threadWorktrees.filter((entry) => entry.worktreePath.length > 0);
  if (worktrees.length > 0) {
    return worktrees.map((entry) => ({ repoRoot: entry.repoRoot, cwd: entry.worktreePath }));
  }
  if (input.threadWorktreePath) {
    return [];
  }
  const repoRoots = input.repoRoots ?? [];
  if (repoRoots.length > 1) {
    return repoRoots.map((repoRoot) => ({ repoRoot, cwd: repoRoot }));
  }
  return [];
}
