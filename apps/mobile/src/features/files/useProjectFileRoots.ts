import type { EnvironmentId, WorkspaceFolder } from "@t3tools/contracts";
import { projectFileRoots, type ProjectFileRoot } from "@t3tools/client-runtime/project-file-roots";
import { useMemo } from "react";

import { useWorkspaceRepositories } from "../../state/workspace-repositories";

export interface ProjectFileRootsState {
  readonly roots: ReadonlyArray<ProjectFileRoot>;
  /** False until the server has answered; the roots are the folder alone until then. */
  readonly ready: boolean;
  /** Re-reads the workspace file. */
  readonly refresh: () => void;
}

/**
 * The roots the files screen and @ search span for a project folder: the folders its
 * `.code-workspace` lists, or the folder itself.
 */
export function useProjectFileRoots(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly projectName?: string | undefined;
}): ProjectFileRootsState {
  const listing = useWorkspaceRepositories({
    environmentId: input.environmentId,
    cwd: input.cwd,
  });
  // A refetch yields a new folders array with the same content; keying on the content keeps the
  // roots identity stable so effects keyed on them do not rebuild the tree.
  const foldersKey = JSON.stringify(listing.folders ?? null);
  const cwd = input.cwd ?? "";
  const projectName = input.projectName;
  const roots = useMemo(
    () =>
      projectFileRoots({
        cwd,
        projectName,
        folders: (JSON.parse(foldersKey) as ReadonlyArray<WorkspaceFolder> | null) ?? undefined,
      }),
    [cwd, foldersKey, projectName],
  );
  return { roots, ready: listing.settled, refresh: listing.refresh };
}
