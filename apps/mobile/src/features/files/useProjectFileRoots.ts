import {
  resolveProjectFileRoots,
  type ProjectFileRoot,
} from "@t3tools/client-runtime/project-file-roots";
import type { EnvironmentId, OrchestrationThreadWorktree } from "@t3tools/contracts";
import { useMemo } from "react";

import { filesystemEnvironment } from "../../state/filesystem";
import { useEnvironmentQuery } from "../../state/query";
import { useSelectedThreadDetail } from "../../state/use-thread-detail";
import { useThreadSelection } from "../../state/use-thread-selection";

export interface ProjectFileRootsState {
  /** Null spans the single project or worktree cwd. */
  readonly roots: ReadonlyArray<ProjectFileRoot> | null;
  /** The first read of the folder list has not settled; the file tree holds until it has. */
  readonly pending: boolean;
  readonly refresh: () => void;
}

/**
 * Folders the file tree and @-mention search span for a `.code-workspace`
 * project: the ones the file lists, with a repo an isolated run covers swapped
 * for its worktree. Any other project keeps its single cwd.
 */
export function useProjectFileRoots(input: {
  readonly environmentId: EnvironmentId | null;
  readonly project:
    | {
        readonly workspaceFile?: string | undefined;
        readonly repoRoots?: ReadonlyArray<string> | undefined;
      }
    | null
    | undefined;
  readonly worktrees: ReadonlyArray<OrchestrationThreadWorktree> | undefined;
}): ProjectFileRootsState {
  const { environmentId, worktrees } = input;
  const workspaceFile = input.project?.workspaceFile ?? null;
  const repoRoots = input.project?.repoRoots;
  const workspaceFileQuery = useEnvironmentQuery(
    environmentId === null || workspaceFile === null
      ? null
      : filesystemEnvironment.readWorkspaceFile({
          environmentId,
          input: { workspaceFilePath: workspaceFile },
        }),
  );
  const workspaceFolders = workspaceFileQuery.data?.folders ?? null;
  const roots = useMemo(
    () =>
      workspaceFile === null
        ? null
        : resolveProjectFileRoots({ workspaceFolders, repoRoots, worktrees }),
    [workspaceFile, workspaceFolders, repoRoots, worktrees],
  );
  return {
    roots,
    pending:
      environmentId !== null &&
      workspaceFile !== null &&
      workspaceFileQuery.data === null &&
      workspaceFileQuery.error === null,
    refresh: workspaceFileQuery.refresh,
  };
}

/** `useProjectFileRoots` for the thread the current route selects. */
export function useSelectedThreadFileRoots(): ProjectFileRootsState {
  const { selectedThread, selectedThreadProject } = useThreadSelection();
  const selectedThreadDetail = useSelectedThreadDetail();
  // The shell arrives before the detail and both carry the per-repo worktree
  // map; take whichever has it.
  const worktrees = selectedThreadDetail?.worktrees?.length
    ? selectedThreadDetail.worktrees
    : selectedThread?.worktrees;
  return useProjectFileRoots({
    environmentId: selectedThread?.environmentId ?? null,
    project: selectedThreadProject,
    worktrees,
  });
}
