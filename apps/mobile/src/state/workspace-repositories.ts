import type { EnvironmentId, VcsRepository, WorkspaceFolder } from "@t3tools/contracts";

import { useEnvironmentQuery } from "./query";
import { vcsEnvironment } from "./vcs";

const NO_REPOSITORIES: ReadonlyArray<VcsRepository> = [];

/**
 * What a project folder holds when it is a multi-repo workspace: its repositories, and the
 * folders its `.code-workspace` lists, git or not. An ordinary checkout lists neither.
 * `settled` stays false until the server has answered, so callers can hold rather than show
 * the folder alone first.
 */
export function useWorkspaceRepositories(input: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly cwd: string | null | undefined;
}): {
  readonly repositories: ReadonlyArray<VcsRepository>;
  readonly folders: ReadonlyArray<WorkspaceFolder> | undefined;
  readonly settled: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
} {
  const { environmentId, cwd } = input;
  const listing = environmentId != null && cwd != null && cwd.length > 0;
  const query = useEnvironmentQuery(
    listing ? vcsEnvironment.listRepositories({ environmentId, input: { cwd } }) : null,
  );
  return {
    repositories: query.data?.repositories ?? NO_REPOSITORIES,
    folders: query.data?.folders,
    settled: !listing || query.data !== null || query.error !== null,
    error: query.error,
    refresh: query.refresh,
  };
}
