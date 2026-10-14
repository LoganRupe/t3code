import type { VcsRef, VcsRepository } from "@t3tools/contracts";

/** A base ref the user picked for one repository of a multi-repo workspace's isolated run. */
export interface RepositoryBaseRef {
  readonly relativePath: string;
  readonly baseRef: string;
}

/**
 * The branches a repository can start from, and its default. Local branches, plus the default
 * branch's origin copy when it has no local one, so the default the server would use is always
 * pickable. The default falls back to the checkout while the refs say nothing better.
 */
export function repositoryBaseRefChoices(refs: ReadonlyArray<VcsRef>): {
  readonly branchNames: ReadonlyArray<string>;
  readonly defaultName: string | null;
} {
  const local = refs.filter((ref) => !ref.isRemote).map((ref) => ref.name);
  const remoteDefault = refs.find((ref) => ref.isRemote && ref.isDefault);
  return {
    branchNames:
      remoteDefault && !refs.some((ref) => !ref.isRemote && ref.isDefault)
        ? [remoteDefault.name, ...local]
        : local,
    defaultName:
      refs.find((ref) => ref.isDefault && !ref.isRemote)?.name ??
      refs.find((ref) => ref.isDefault)?.name ??
      refs.find((ref) => ref.current)?.name ??
      null,
  };
}

/** Sets one repository's pick; a null `baseRef` clears it, returning it to its default branch. */
export function withRepositoryBaseRef(
  picks: ReadonlyArray<RepositoryBaseRef>,
  relativePath: string,
  baseRef: string | null,
): ReadonlyArray<RepositoryBaseRef> {
  const others = picks.filter((pick) => pick.relativePath !== relativePath);
  return baseRef === null ? others : [...others, { relativePath, baseRef }];
}

/**
 * The repositories of a workspace that get a base branch picker of their own: every one but the
 * workspace folder's own repository, which keeps the regular branch selector.
 */
export function repositoriesWithOwnBaseRef(
  repositories: ReadonlyArray<VcsRepository>,
): ReadonlyArray<VcsRepository> {
  return repositories.filter((repository) => repository.relativePath !== ".");
}

/** The picks that still name one of `repositories`, in the order the workspace lists them. */
export function repositoryBaseRefsFor(
  picks: ReadonlyArray<RepositoryBaseRef>,
  repositories: ReadonlyArray<Pick<VcsRepository, "relativePath">>,
): ReadonlyArray<RepositoryBaseRef> {
  return repositories.flatMap((repository) => {
    const pick = picks.find((candidate) => candidate.relativePath === repository.relativePath);
    return pick ? [pick] : [];
  });
}

/**
 * Whether the project folder has a branch of its own to start a worktree from: an ordinary
 * checkout does, and so does a workspace folder that is itself one of its repositories. Any
 * other multi-repo workspace folder has none, and each repository starts from its own base.
 */
export function folderHasOwnBranch(
  repositories: ReadonlyArray<Pick<VcsRepository, "relativePath">>,
): boolean {
  return (
    repositories.length === 0 || repositories.some((repository) => repository.relativePath === ".")
  );
}
