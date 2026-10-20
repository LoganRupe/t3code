/**
 * WorkspaceWorktrees - isolated checkouts for multi-repo workspaces.
 *
 * An isolated run in a multi-repo project gets a container folder that mirrors the project:
 * one Git worktree per repository, all on the thread's branch. A repository inside the project
 * keeps its relative path, one listed outside it sits at its name, and when the project folder
 * is itself a repository its worktree is the container, so the agent's working directory is
 * that checkout with the others inside it. A container that is not a checkout also gets links
 * to the project's other top-level files and folders, so shared instructions and editor
 * settings resolve the way they do in the project. A layout file beside the container records
 * what was placed where, and from which checkout; discovery reads it, so the thread can record
 * the container as its worktree path and everything that works on one folder keeps working.
 *
 * @module WorkspaceWorktrees
 */
import {
  GitCommandError,
  isOutsideWorkspaceRepository,
  type VcsRepository,
} from "@t3tools/contracts";
import {
  flattenTemporaryWorktreeBranchName,
  isTemporaryWorktreeBranch,
  WORKTREE_BRANCH_PREFIX,
} from "@t3tools/shared/git";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as WorkspaceRepositories from "../workspace/WorkspaceRepositories.ts";
import {
  retargetIsolatedRunWorkspaceFolder,
  writeIsolatedRunWorkspaceFile,
} from "./isolatedRunWorkspaceFile.ts";

export interface CreateWorkspaceWorktreeInput {
  readonly workspaceRoot: string;
  readonly repositories: ReadonlyArray<VcsRepository>;
  readonly branch: string;
  /** Fetch each repository's base and start from the remote's copy. */
  readonly startFromOrigin: boolean;
  /**
   * The ref a particular repository starts from, by its `relativePath`. A repository left out
   * starts from its default branch. A ref that does not resolve in its repository fails the
   * run instead of silently starting elsewhere.
   */
  readonly baseRefs?: ReadonlyArray<{ readonly relativePath: string; readonly baseRef: string }>;
  /**
   * The project's repositories that get no worktree. The run reaches their checkouts instead,
   * through a link where their worktree would go when the container is not itself a checkout.
   */
  readonly references?: ReadonlyArray<VcsRepository>;
}

export class WorkspaceWorktrees extends Context.Service<
  WorkspaceWorktrees,
  {
    /**
     * Create a container with a worktree per repository, each started from the base ref chosen
     * for it, or its repository's default branch. The container is reported as soon as it
     * exists so a caller can remove a partial one with `remove` if a later repository fails.
     */
    readonly create: (
      input: CreateWorkspaceWorktreeInput,
      options?: { readonly onContainerClaimed?: (path: string) => Effect.Effect<void> },
    ) => Effect.Effect<{ readonly path: string; readonly branch: string }, GitCommandError>;
    /** Rename the branch in every repository; the first repository decides the final name. */
    readonly renameBranch: (input: {
      readonly path: string;
      readonly oldBranch: string;
      readonly newBranch: string;
      readonly exactName?: boolean;
    }) => Effect.Effect<{ readonly branch: string }, GitCommandError>;
    /** Whether `path` is a container this service created. */
    readonly isContainer: (path: string) => Effect.Effect<boolean>;
    /**
     * Give a repository the run left out a worktree on the run's branch: the branch itself when
     * the repository already has it, else a new one from its default branch.
     */
    readonly addRepository: (input: {
      readonly path: string;
      readonly relativePath: string;
    }) => Effect.Effect<void, GitCommandError>;
    /**
     * Remove one repository's worktree, keeping its branch, and reach the project's checkout
     * again. Refuses the root repository, the last one, and a worktree with uncommitted changes.
     */
    readonly removeRepository: (input: {
      readonly path: string;
      readonly relativePath: string;
    }) => Effect.Effect<void, GitCommandError>;
    /**
     * Remove every repository's worktree, then the links and folders the container added.
     * Anything else left in the container is kept for the user, and it stays a container.
     */
    readonly remove: (input: {
      readonly path: string;
      readonly force: boolean;
    }) => Effect.Effect<void, GitCommandError>;
  }
>()("t3/git/WorkspaceWorktrees") {}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const workspaceRepositories = yield* WorkspaceRepositories.WorkspaceRepositories;

  const fail = (operation: string, cwd: string, detail: string, cause?: unknown) =>
    new GitCommandError({ operation, command: "worktree", cwd, detail, cause });

  const join = (root: string, relativePath: string) => path.join(root, ...relativePath.split("/"));
  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));
  const encodeLayout = Schema.encodeEffect(
    Schema.fromJsonString(WorkspaceRepositories.IsolatedRunLayout),
  );

  const writeLayout = (container: string, layout: WorkspaceRepositories.IsolatedRunLayout) =>
    encodeLayout(layout).pipe(
      Effect.flatMap((contents) =>
        fileSystem.writeFileString(
          WorkspaceRepositories.isolatedRunLayoutPath(container),
          contents,
        ),
      ),
      Effect.mapError((cause) =>
        fail("WorkspaceWorktrees.writeLayout", container, `Could not update ${container}.`, cause),
      ),
    );

  // Where a repository's worktree goes in the container: the root repository is the container
  // itself, a repository outside the project sits at its name, and a nested one keeps its path.
  const placement = (repository: VcsRepository) =>
    isOutsideWorkspaceRepository(repository) ? repository.name : repository.relativePath;

  const isInsideWorktreesDir = (target: string) => {
    const relative = path.relative(config.worktreesDir, target);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  };

  const hasCommit = (cwd: string, refName: string) =>
    git
      .execute({
        operation: "WorkspaceWorktrees.hasCommit",
        cwd,
        args: ["rev-parse", "--verify", "--quiet", `${refName}^{commit}`],
        allowNonZeroExit: true,
      })
      .pipe(Effect.map((result) => result.exitCode === 0));

  // The ref chosen for the repository, else its default branch (from its primary remote), else
  // its current checkout. A chosen ref must resolve; a default is only a preference.
  const resolveStart = Effect.fn("WorkspaceWorktrees.resolveStart")(function* (
    repository: VcsRepository,
    startFromOrigin: boolean,
    requestedBaseRef: string | null,
  ) {
    const cwd = repository.path;
    const remote = yield* git.resolvePrimaryRemoteName(cwd).pipe(Effect.option);
    const baseBranch =
      requestedBaseRef ??
      (remote._tag === "None"
        ? null
        : yield* git
            .resolveDefaultBranchName(cwd, remote.value)
            .pipe(Effect.orElseSucceed(() => null)));
    if (remote._tag === "Some" && baseBranch !== null && startFromOrigin) {
      yield* git.fetchRemote({ cwd, remoteName: remote.value, refName: baseBranch });
      if (yield* git.remoteBranchExists({ cwd, remoteName: remote.value, refName: baseBranch })) {
        const tracking = yield* git.resolveRemoteTrackingCommit({
          cwd,
          refName: baseBranch,
          fallbackRemoteName: remote.value,
        });
        return { startRef: tracking.commitSha, baseRef: baseBranch };
      }
    }
    if (baseBranch !== null && (yield* hasCommit(cwd, baseBranch))) {
      return { startRef: baseBranch, baseRef: baseBranch };
    }
    if (requestedBaseRef !== null) {
      return yield* fail(
        "WorkspaceWorktrees.resolveStart",
        cwd,
        `Base ref "${requestedBaseRef}" does not resolve to a commit in ${repository.name}.`,
      );
    }
    return { startRef: "HEAD", baseRef: "HEAD" };
  });

  // Links are a convenience, so a platform that refuses one only loses that entry. A
  // `.code-workspace` file defines which folders belong to the workspace, so with one only its
  // listed folders are linked, along with top-level files and dot-folders, which usually hold
  // workspace-wide configuration. Without one, every top-level entry is linked.
  const linkSharedEntries = Effect.fn("WorkspaceWorktrees.linkSharedEntries")(function* (
    workspaceRoot: string,
    container: string,
  ) {
    const layout = yield* workspaceRepositories.describe(workspaceRoot);
    const repositoryFolders = new Set(
      layout.repositories.map((repository) => repository.relativePath.split("/")[0]),
    );
    const listedFolders =
      layout.folders === null
        ? null
        : new Set(layout.folders.map((folder) => folder.relativePath.split("/")[0]));
    const names = yield* fileSystem
      .readDirectory(workspaceRoot)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const name of names) {
      if (repositoryFolders.has(name)) continue;
      const target = path.join(workspaceRoot, name);
      if (listedFolders !== null && !name.startsWith(".") && !listedFolders.has(name)) {
        const isDirectory = yield* fileSystem.stat(target).pipe(
          Effect.map((info) => info.type === "Directory"),
          Effect.orElseSucceed(() => false),
        );
        if (isDirectory) continue;
      }
      yield* fileSystem.symlink(target, path.join(container, name)).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not link a workspace entry into an isolated run", {
            container,
            name,
            cause,
          }),
        ),
      );
    }
  });

  const createWorktree = Effect.fn("WorkspaceWorktrees.createWorktree")(function* (
    repository: VcsRepository,
    worktreePath: string,
    branch: string,
    input: CreateWorkspaceWorktreeInput,
  ) {
    const source = repository.path;
    yield* fileSystem
      .makeDirectory(path.dirname(worktreePath), { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          fail("WorkspaceWorktrees.create", source, `Could not create ${worktreePath}.`, cause),
        ),
      );
    const requestedBaseRef =
      input.baseRefs?.find((entry) => entry.relativePath === repository.relativePath)?.baseRef ??
      null;
    const start = yield* resolveStart(repository, input.startFromOrigin, requestedBaseRef);
    yield* git.createWorktree({
      cwd: source,
      refName: start.startRef,
      newRefName: branch,
      baseRefName: start.baseRef,
      path: worktreePath,
    });
  });

  const create: WorkspaceWorktrees["Service"]["create"] = Effect.fn("WorkspaceWorktrees.create")(
    function* (input, options) {
      const operation = "WorkspaceWorktrees.create";
      // A plain `t3` branch in any repository blocks `t3/*`, so all of them use `t3-<hash>`.
      let branch = input.branch;
      if (isTemporaryWorktreeBranch(branch)) {
        for (const repository of input.repositories) {
          if (yield* hasCommit(repository.path, `refs/heads/${WORKTREE_BRANCH_PREFIX}`)) {
            branch = flattenTemporaryWorktreeBranchName(branch);
            break;
          }
        }
      }
      const container = path.join(
        config.worktreesDir,
        path.basename(input.workspaceRoot),
        branch.replace(/\//g, "-"),
      );
      if (yield* fileSystem.exists(container).pipe(Effect.orElseSucceed(() => true))) {
        return yield* fail(operation, input.workspaceRoot, `${container} already exists.`);
      }
      const root = input.repositories.find((repository) => repository.relativePath === ".");
      const nested = input.repositories.filter((repository) => repository !== root);
      // A link inside a root repository's worktree would show up in its changes, so a run
      // whose root is a checkout reaches the left-out repositories where they are.
      const references = (input.references ?? []).map((repository) => ({
        relativePath: placement(repository),
        name: repository.name,
        source: repository.path,
        linked: root === undefined,
      }));
      // Listed folders keep their place in the run: a repository at its worktree, a folder inside
      // the project at its link, and a plain folder outside the project stays the original.
      const workspaceFolders = (yield* workspaceRepositories.describe(input.workspaceRoot)).folders;
      const folderPlacement = (folder: VcsRepository) => {
        const repository = input.repositories.find((candidate) => candidate.path === folder.path);
        if (repository !== undefined) return placement(repository);
        const reference = references.find((candidate) => candidate.source === folder.path);
        if (reference !== undefined) return reference.linked ? reference.relativePath : folder.path;
        return isOutsideWorkspaceRepository(folder) ? folder.path : folder.relativePath;
      };
      // The layout file goes first: it is what makes the folder a container, so a failure
      // below can still be cleaned up with `remove`.
      yield* encodeLayout({
        repositories: input.repositories.map((repository) => ({
          relativePath: placement(repository),
          name: repository.name,
          source: repository.path,
        })),
        ...(workspaceFolders === null
          ? {}
          : {
              folders: workspaceFolders.map((folder) => ({
                relativePath: folderPlacement(folder),
                name: folder.name,
              })),
            }),
        ...(references.length === 0 ? {} : { references }),
      }).pipe(
        Effect.flatMap((contents) =>
          fileSystem
            .makeDirectory(path.dirname(container), { recursive: true })
            .pipe(
              Effect.andThen(
                fileSystem.writeFileString(
                  WorkspaceRepositories.isolatedRunLayoutPath(container),
                  contents,
                ),
              ),
            ),
        ),
        Effect.mapError((cause) =>
          fail(operation, input.workspaceRoot, `Could not create ${container}.`, cause),
        ),
      );
      if (options?.onContainerClaimed) yield* options.onContainerClaimed(container);
      if (root === undefined) {
        yield* fileSystem
          .makeDirectory(container, { recursive: true })
          .pipe(
            Effect.mapError((cause) =>
              fail(operation, input.workspaceRoot, `Could not create ${container}.`, cause),
            ),
          );
        yield* linkSharedEntries(input.workspaceRoot, container);
      } else {
        // The root repository's checkout is the container, so there is nothing to link.
        yield* createWorktree(root, container, branch, input);
      }
      for (const repository of nested) {
        yield* createWorktree(repository, join(container, placement(repository)), branch, input);
      }
      for (const reference of references) {
        if (reference.linked) yield* linkReference(container, reference);
      }
      // Editors open the run the way they open the project. Losing that is not worth failing.
      const projectWorkspaceFile = yield* workspaceRepositories.workspaceFile(input.workspaceRoot);
      if (projectWorkspaceFile !== null) {
        yield* writeIsolatedRunWorkspaceFile({
          projectWorkspaceFile,
          container,
          repositories: input.repositories.map((repository) => ({
            source: repository.path,
            worktree: join(container, placement(repository)),
          })),
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.catch((cause) =>
            Effect.logWarning("Could not write an isolated run's workspace file", {
              container,
              cause,
            }),
          ),
        );
      }
      return { path: container, branch };
    },
  );

  // A missing link only costs the agent a path, which the layout still names, so it is logged.
  const linkReference = (
    container: string,
    reference: { readonly relativePath: string; readonly source: string },
  ) => {
    const target = join(container, reference.relativePath);
    return fileSystem.makeDirectory(path.dirname(target), { recursive: true }).pipe(
      Effect.andThen(fileSystem.symlink(reference.source, target)),
      Effect.catch((cause) =>
        Effect.logWarning("Could not link a left-out repository into an isolated run", {
          container,
          relativePath: reference.relativePath,
          cause,
        }),
      ),
    );
  };

  const readRun = (operation: string, container: string) =>
    Effect.gen(function* () {
      const layout = isInsideWorktreesDir(container)
        ? yield* workspaceRepositories.readIsolatedRun(container)
        : null;
      if (layout === null) return yield* fail(operation, container, "Not an isolated run folder.");
      return layout;
    });

  const currentBranch = (operation: string, cwd: string) =>
    git
      .execute({ operation, cwd, args: ["branch", "--show-current"] })
      .pipe(Effect.map((result) => result.stdout.trim()));

  // The editor's copy of the project's workspace file follows the repository's new place.
  const retargetWorkspaceFile = (container: string, from: string, to: string) =>
    retargetIsolatedRunWorkspaceFolder({ container, from, to }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.catch((cause) =>
        Effect.logWarning("Could not update an isolated run's workspace file", {
          container,
          cause,
        }),
      ),
    );

  const addRepository: WorkspaceWorktrees["Service"]["addRepository"] = Effect.fn(
    "WorkspaceWorktrees.addRepository",
  )(function* (input) {
    const operation = "WorkspaceWorktrees.addRepository";
    const layout = yield* readRun(operation, input.path);
    const reference = layout.references?.find(
      (candidate) => candidate.relativePath === input.relativePath,
    );
    if (reference === undefined) {
      return yield* fail(
        operation,
        input.path,
        `${input.relativePath} is not a repository this run left out.`,
      );
    }
    const anchor = layout.repositories[0];
    const branch =
      anchor === undefined
        ? ""
        : yield* currentBranch(operation, path.resolve(input.path, anchor.relativePath));
    if (branch === "") {
      return yield* fail(operation, input.path, "The run is not on a branch to add to.");
    }
    const worktreePath = join(input.path, reference.relativePath);
    if (reference.linked) {
      yield* fileSystem.remove(worktreePath).pipe(Effect.ignore);
    }
    const repository = {
      relativePath: reference.relativePath,
      name: reference.name,
      path: reference.source,
    };
    yield* Effect.gen(function* () {
      if (yield* hasCommit(reference.source, `refs/heads/${branch}`)) {
        yield* fileSystem
          .makeDirectory(path.dirname(worktreePath), { recursive: true })
          .pipe(
            Effect.mapError((cause) =>
              fail(operation, reference.source, `Could not create ${worktreePath}.`, cause),
            ),
          );
        yield* git.createWorktree({ cwd: reference.source, refName: branch, path: worktreePath });
      } else {
        yield* createWorktree(repository, worktreePath, branch, {
          workspaceRoot: input.path,
          repositories: [repository],
          branch,
          startFromOrigin: false,
        });
      }
    }).pipe(
      // Put the link back so the run keeps reaching the repository.
      Effect.tapError(() =>
        reference.linked ? linkReference(input.path, reference) : Effect.void,
      ),
    );
    yield* writeLayout(input.path, {
      ...layout,
      repositories: [
        ...layout.repositories,
        { relativePath: reference.relativePath, name: reference.name, source: reference.source },
      ],
      ...(layout.folders === undefined
        ? {}
        : {
            folders: layout.folders.map((folder) =>
              folder.relativePath === reference.source
                ? { ...folder, relativePath: reference.relativePath }
                : folder,
            ),
          }),
      references: (layout.references ?? []).filter((candidate) => candidate !== reference),
    });
    yield* retargetWorkspaceFile(input.path, reference.source, worktreePath);
  });

  const removeRepository: WorkspaceWorktrees["Service"]["removeRepository"] = Effect.fn(
    "WorkspaceWorktrees.removeRepository",
  )(function* (input) {
    const operation = "WorkspaceWorktrees.removeRepository";
    const layout = yield* readRun(operation, input.path);
    const repository = layout.repositories.find(
      (candidate) => candidate.relativePath === input.relativePath,
    );
    if (repository === undefined) {
      return yield* fail(
        operation,
        input.path,
        `${input.relativePath} has no worktree in this run.`,
      );
    }
    if (repository.relativePath === ".") {
      return yield* fail(operation, input.path, "The run's own repository cannot be removed.");
    }
    if (layout.repositories.length === 1) {
      return yield* fail(operation, input.path, "A run keeps at least one repository.");
    }
    const worktreePath = join(input.path, repository.relativePath);
    const changes = yield* git.execute({
      operation,
      cwd: worktreePath,
      args: ["status", "--porcelain"],
    });
    if (changes.stdout.trim() !== "") {
      return yield* fail(
        operation,
        worktreePath,
        `${repository.name} has uncommitted changes. Commit or discard them first.`,
      );
    }
    yield* git.removeWorktree({ cwd: repository.source, path: worktreePath, force: false });
    const linked = !layout.repositories.some((candidate) => candidate.relativePath === ".");
    const reference = { ...repository, linked };
    if (linked) yield* linkReference(input.path, reference);
    yield* writeLayout(input.path, {
      ...layout,
      repositories: layout.repositories.filter((candidate) => candidate !== repository),
      ...(layout.folders === undefined || linked
        ? {}
        : {
            folders: layout.folders.map((folder) =>
              folder.relativePath === repository.relativePath
                ? { ...folder, relativePath: repository.source }
                : folder,
            ),
          }),
      references: [...(layout.references ?? []), reference],
    });
    yield* retargetWorkspaceFile(input.path, worktreePath, repository.source);
  });

  const renameBranch: WorkspaceWorktrees["Service"]["renameBranch"] = Effect.fn(
    "WorkspaceWorktrees.renameBranch",
  )(function* (input) {
    const [first, ...rest] = yield* workspaceRepositories.list(input.path);
    if (first === undefined) {
      return yield* fail(
        "WorkspaceWorktrees.renameBranch",
        input.path,
        "The isolated run holds no repositories.",
      );
    }
    const renamed = yield* git.renameBranch({
      cwd: first.path,
      oldBranch: input.oldBranch,
      newBranch: input.newBranch,
      ...(input.exactName ? { exactName: true } : {}),
    });
    for (const [index, repository] of rest.entries()) {
      yield* git
        .renameBranch({
          cwd: repository.path,
          oldBranch: input.oldBranch,
          newBranch: renamed.branch,
          exactName: true,
        })
        .pipe(
          // Put the renamed repositories back so every repository stays on one branch.
          Effect.tapError(() =>
            Effect.forEach([first, ...rest.slice(0, index)], (done) =>
              git
                .renameBranch({
                  cwd: done.path,
                  oldBranch: renamed.branch,
                  newBranch: input.oldBranch,
                  exactName: true,
                })
                .pipe(Effect.ignore({ log: true })),
            ),
          ),
        );
    }
    return { branch: renamed.branch };
  });

  const isLink = (target: string) =>
    fileSystem.readLink(target).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  // Only this service writes layout files, so one beside a folder in the worktrees directory
  // proves the folder is a container, whether or not its root is a checkout.
  const isContainer: WorkspaceWorktrees["Service"]["isContainer"] = (target) =>
    isInsideWorktreesDir(target)
      ? exists(WorkspaceRepositories.isolatedRunLayoutPath(target))
      : Effect.succeed(false);

  // Removes links and the folders nested repositories needed, bottom-up, keeping real files.
  const removeLeftovers = (
    directory: string,
  ): Effect.Effect<boolean, PlatformError.PlatformError> =>
    Effect.gen(function* () {
      for (const name of yield* fileSystem.readDirectory(directory)) {
        const entry = path.join(directory, name);
        if (yield* isLink(entry)) {
          yield* fileSystem.remove(entry);
        } else if ((yield* fileSystem.stat(entry)).type === "Directory") {
          yield* removeLeftovers(entry);
        }
      }
      if ((yield* fileSystem.readDirectory(directory)).length > 0) return false;
      yield* fileSystem.remove(directory, { recursive: true });
      return true;
    });

  const remove: WorkspaceWorktrees["Service"]["remove"] = Effect.fn("WorkspaceWorktrees.remove")(
    function* (input) {
      const operation = "WorkspaceWorktrees.remove";
      const layout = isInsideWorktreesDir(input.path)
        ? yield* workspaceRepositories.readIsolatedRun(input.path)
        : null;
      if (layout === null) {
        return yield* fail(operation, input.path, "Not an isolated run folder.");
      }
      const root = layout.repositories.find((repository) => repository.relativePath === ".");
      // Nested worktrees first: the root repository's worktree is the container itself.
      const ordered = [
        ...layout.repositories.filter((repository) => repository !== root),
        ...(root === undefined ? [] : [root]),
      ];
      for (const repository of ordered) {
        const worktreePath = path.resolve(input.path, repository.relativePath);
        // A run that failed partway may never have reached this repository.
        if (!(yield* exists(worktreePath))) continue;
        yield* git.removeWorktree({
          cwd: repository.source,
          path: worktreePath,
          force: input.force,
        });
      }
      if (root === undefined && (yield* exists(input.path))) {
        yield* Effect.gen(function* () {
          if (yield* removeLeftovers(input.path)) return;
          // The pre-V2 multi-repo fork wrote its workspace file as a real file in the container,
          // so a run it made still holds that file once everything else is gone.
          const names = yield* fileSystem.readDirectory(input.path);
          if (
            names.length === 1 &&
            names[0]!.endsWith(WorkspaceRepositories.CODE_WORKSPACE_EXTENSION) &&
            (yield* fileSystem.stat(path.join(input.path, names[0]!))).type === "File"
          ) {
            yield* fileSystem.remove(input.path, { recursive: true });
          }
        }).pipe(
          Effect.mapError((cause) =>
            fail(operation, input.path, "Could not remove the isolated run folder.", cause),
          ),
        );
      }
      if (!(yield* exists(input.path))) {
        yield* fileSystem
          .remove(WorkspaceRepositories.isolatedRunLayoutPath(input.path), { force: true })
          .pipe(Effect.ignore);
        yield* fileSystem
          .remove(WorkspaceRepositories.isolatedRunWorkspaceFilePath(input.path), { force: true })
          .pipe(Effect.ignore);
      }
    },
  );

  return WorkspaceWorktrees.of({
    create,
    addRepository,
    removeRepository,
    renameBranch,
    isContainer,
    remove,
  });
});

export const layer = Layer.effect(WorkspaceWorktrees, make).pipe(
  Layer.provide(WorkspaceRepositories.layer),
);
