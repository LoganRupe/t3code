import {
  WORKTREE_ALL_REPOSITORIES_LIMIT,
  type VcsRef,
  type VcsRepository,
} from "@t3tools/contracts";

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

export { WORKTREE_ALL_REPOSITORIES_LIMIT };

/**
 * The repositories (by `relativePath`) that get a worktree in a new isolated run: the user's
 * picks that the workspace still lists, else every repository in a small workspace and none in
 * a large one. The workspace folder's own repository (`.`) always gets one and is left out here.
 */
export function worktreeRepositoriesFor(
  picks: ReadonlyArray<string> | undefined,
  repositories: ReadonlyArray<Pick<VcsRepository, "relativePath">>,
): ReadonlyArray<string> {
  const others = repositories
    .map((repository) => repository.relativePath)
    .filter((relativePath) => relativePath !== ".");
  if (picks !== undefined) return others.filter((relativePath) => picks.includes(relativePath));
  return others.length <= WORKTREE_ALL_REPOSITORIES_LIMIT ? others : [];
}

/** Repository lists longer than this get a filter field. */
export const REPOSITORY_FILTER_THRESHOLD = 5;

/** The repositories whose name or path contains `query`, ignoring case; all of them when empty. */
export function filterRepositories<R extends Pick<VcsRepository, "relativePath" | "name">>(
  repositories: ReadonlyArray<R>,
  query: string,
): ReadonlyArray<R> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return repositories;
  return repositories.filter(
    (repository) =>
      repository.name.toLowerCase().includes(needle) ||
      repository.relativePath.toLowerCase().includes(needle),
  );
}

/** Adds or drops one repository from the picks. */
export function withWorktreeRepository(
  picks: ReadonlyArray<string>,
  relativePath: string,
  included: boolean,
): ReadonlyArray<string> {
  const others = picks.filter((candidate) => candidate !== relativePath);
  return included ? [...others, relativePath] : others;
}

/**
 * The `repositories` a launch sends for the picks, or undefined when every repository gets a
 * worktree, which is what the server does without the field. Empty when nothing gets one, which
 * a client checks with `hasWorktreeRepository` before it sends.
 */
export function worktreeRepositoriesForSend(
  picks: ReadonlyArray<string> | undefined,
  repositories: ReadonlyArray<Pick<VcsRepository, "relativePath">>,
): ReadonlyArray<string> | undefined {
  if (repositories.length === 0) return undefined;
  const selected = worktreeRepositoriesFor(picks, repositories);
  const others = repositories.filter((repository) => repository.relativePath !== ".");
  return selected.length === others.length ? undefined : selected;
}

/** Whether a new isolated run would give at least one repository a worktree. */
export function hasWorktreeRepository(
  picks: ReadonlyArray<string> | undefined,
  repositories: ReadonlyArray<Pick<VcsRepository, "relativePath">>,
): boolean {
  return (
    folderHasOwnBranch(repositories) || worktreeRepositoriesFor(picks, repositories).length > 0
  );
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
