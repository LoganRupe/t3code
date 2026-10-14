import type { EnvironmentId, VcsRepository } from "@t3tools/contracts";

import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";

const NO_REPOSITORIES: ReadonlyArray<VcsRepository> = [];

interface WorkspaceRepositoriesInput {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly isRepo: boolean | undefined;
}

// The folder may itself be one of the repositories, so the request waits only for Git status
// to settle; an ordinary checkout answers with none.
function useListRepositories(input: WorkspaceRepositoriesInput) {
  return useEnvironmentQuery(
    input.environmentId !== null && input.cwd !== null && input.isRepo !== undefined
      ? vcsEnvironment.listRepositories({
          environmentId: input.environmentId,
          input: { cwd: input.cwd },
        })
      : null,
  );
}

/** Repositories a multi-repo workspace folder holds. */
export function useWorkspaceRepositories(
  input: WorkspaceRepositoriesInput,
): ReadonlyArray<VcsRepository> {
  return useListRepositories(input).data?.repositories ?? NO_REPOSITORIES;
}

/** The `.code-workspace` file editors should open for the folder, or null without one. */
export function useWorkspaceFile(input: WorkspaceRepositoriesInput): string | null {
  return useListRepositories(input).data?.workspaceFile ?? null;
}
