import type { EnvironmentId, WorkspaceFolder } from "@t3tools/contracts";
import {
  projectFileRoots,
  type ProjectFileRoot,
} from "@t3tools/client-runtime/project-file-roots";
import { useMemo } from "react";

import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";

/**
 * The roots the files panel, breadcrumbs and @ search span for a project folder: the folders its
 * `.code-workspace` lists, or the folder itself. Until the server has answered, `ready` is false
 * and the roots are the folder alone, so callers can hold the tree instead of flashing it.
 */
export function useProjectFileRoots(input: {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly projectName?: string | undefined;
}): {
  readonly roots: ReadonlyArray<ProjectFileRoot>;
  readonly ready: boolean;
  /** Re-reads the workspace file. */
  readonly refresh: () => void;
} {
  const query = useEnvironmentQuery(
    input.environmentId !== null && input.cwd !== null
      ? vcsEnvironment.listRepositories({
          environmentId: input.environmentId,
          input: { cwd: input.cwd },
        })
      : null,
  );
  // A refetch yields a new folders array with the same content; keying on the content keeps the
  // roots identity stable so effects keyed on them do not rebuild the tree.
  const foldersKey = JSON.stringify(query.data?.folders ?? null);
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
  return {
    roots,
    ready: input.cwd === null || query.data !== null || query.error !== null,
    refresh: query.refresh,
  };
}
