import {
  isOutsideWorkspaceRepository,
  VcsUnsupportedOperationError,
  workspaceRepositoryPathPrefix,
  type CheckpointRef,
  type VcsRepository,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { CheckpointStoreError } from "./Errors.ts";
import type { VcsCheckpointOps } from "../vcs/VcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as WorkspaceRepositories from "../workspace/WorkspaceRepositories.ts";
import { parseTurnDiffFilesFromNumstat, prefixNumstatPaths, prefixPatchPaths } from "./Diffs.ts";

export interface CaptureCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  /** Capture only in repositories without the ref, keeping checkpoints already taken. */
  readonly missingOnly?: boolean;
}

/** Folders under a repository that belong to other repositories of the same workspace. */
function nestedRepositoryFolders(
  repository: VcsRepository,
  repositories: ReadonlyArray<VcsRepository>,
): ReadonlyArray<string> {
  if (repository.relativePath !== ".") return [];
  return repositories
    .filter((other) => other.relativePath !== "." && !isOutsideWorkspaceRepository(other))
    .map((other) => other.relativePath);
}

export interface RestoreCheckpointInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  readonly fallbackToHead?: boolean;
}

export interface DiffCheckpointsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
  readonly fallbackFromToHead?: boolean;
  readonly ignoreWhitespace: boolean;
  readonly format?: "patch" | "numstat";
  /** Maximum bytes collected from the diff command. */
  readonly maxOutputBytes?: number;
  /** Limits the diff to these exact paths. An empty list yields an empty diff. */
  readonly filePaths?: ReadonlyArray<string>;
}

export interface ListAuthoredPathsInput {
  readonly cwd: string;
  readonly fromCheckpointRef: CheckpointRef;
  readonly toCheckpointRef: CheckpointRef;
}

export interface DeleteCheckpointRefsInput {
  readonly cwd: string;
  readonly checkpointRefs: ReadonlyArray<CheckpointRef>;
}

/**
 * A multi-repo workspace folder (see `WorkspaceRepositories`) is checkpointed as
 * one unit: every operation fans out to each repository under the same ref, and
 * diffs report paths relative to the workspace folder. Restores check every
 * repository has the ref first, but are not atomic across repositories.
 */
export class CheckpointStore extends Context.Service<
  CheckpointStore,
  {
    readonly isCheckpointable: (cwd: string) => Effect.Effect<boolean, CheckpointStoreError>;

    readonly captureCheckpoint: (
      input: CaptureCheckpointInput,
    ) => Effect.Effect<void, CheckpointStoreError>;

    readonly hasCheckpointRef: (
      input: Omit<RestoreCheckpointInput, "fallbackToHead">,
    ) => Effect.Effect<boolean, CheckpointStoreError>;

    readonly restoreCheckpoint: (
      input: RestoreCheckpointInput,
    ) => Effect.Effect<boolean, CheckpointStoreError>;

    readonly diffCheckpoints: (
      input: DiffCheckpointsInput,
    ) => Effect.Effect<string, CheckpointStoreError>;

    /**
     * Returns null when HEAD did not move or a checkpoint does not record HEAD.
     * Then every changed path belongs to the turn.
     */
    readonly listAuthoredPaths: (
      input: ListAuthoredPathsInput,
    ) => Effect.Effect<ReadonlySet<string> | null, CheckpointStoreError>;

    readonly deleteCheckpointRefs: (
      input: DeleteCheckpointRefsInput,
    ) => Effect.Effect<void, CheckpointStoreError>;
  }
>()("t3/checkpointing/CheckpointStore") {}

/** One repository a checkpoint operation runs in, and where its paths sit under the cwd. */
interface CheckpointTarget {
  readonly cwd: string;
  readonly pathPrefix: string | null;
  /** Folders of other repositories nested under this one, left out of its capture. */
  readonly excludePaths: ReadonlyArray<string>;
}

// Each repository's capture is a handful of short Git processes, so the limit is spawn
// overhead, not CPU: 70 small repositories took 2.2s at 4, 1.5s at 8, and no less at 16.
const MULTI_REPO_CONCURRENCY = 8;

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const workspaceRepositories = yield* WorkspaceRepositories.WorkspaceRepositories;

  const resolveCheckpoints = Effect.fn("CheckpointStore.resolveCheckpoints")(function* (
    operation: string,
    cwd: string,
  ) {
    const handle = yield* vcsRegistry.resolve({ cwd });
    if (!handle.driver.checkpoints) {
      return yield* new VcsUnsupportedOperationError({
        operation,
        kind: handle.kind,
        detail: `${handle.kind} driver does not implement checkpoint operations.`,
      });
    }
    return handle.driver.checkpoints satisfies VcsCheckpointOps;
  });

  const isGitRepository = (cwd: string) =>
    vcsRegistry
      .detect({ cwd, requestedKind: "git" })
      .pipe(Effect.map((repository) => repository !== null));

  // A cwd that holds no workspace stays a single target, whether it is a repository or not,
  // so its operations fail the way they always have.
  const resolveTargets = Effect.fn("CheckpointStore.resolveTargets")(function* (cwd: string) {
    const repositories = yield* workspaceRepositories.list(cwd);
    if (repositories.length === 0) return [{ cwd, pathPrefix: null, excludePaths: [] }];
    return repositories.map((repository): CheckpointTarget => ({
      cwd: repository.path,
      pathPrefix: workspaceRepositoryPathPrefix(repository),
      excludePaths: nestedRepositoryFolders(repository, repositories),
    }));
  });

  const forEachTarget = <A, E, R>(
    targets: ReadonlyArray<CheckpointTarget>,
    run: (target: CheckpointTarget) => Effect.Effect<A, E, R>,
  ) => Effect.forEach(targets, run, { concurrency: MULTI_REPO_CONCURRENCY });

  const isCheckpointable: CheckpointStore["Service"]["isCheckpointable"] = Effect.fn(
    "isCheckpointable",
  )(function* (cwd) {
    if (yield* isGitRepository(cwd)) return true;
    return (yield* workspaceRepositories.list(cwd)).length > 0;
  });

  const hasRefIn = (target: CheckpointTarget, checkpointRef: CheckpointRef) =>
    resolveCheckpoints("CheckpointStore.hasCheckpointRef", target.cwd).pipe(
      Effect.flatMap((checkpoints) =>
        checkpoints.hasCheckpointRef({ cwd: target.cwd, checkpointRef }),
      ),
    );

  const captureCheckpoint: CheckpointStore["Service"]["captureCheckpoint"] = Effect.fn(
    "captureCheckpoint",
  )(function* (input) {
    yield* forEachTarget(yield* resolveTargets(input.cwd), (target) =>
      Effect.gen(function* () {
        if (input.missingOnly && (yield* hasRefIn(target, input.checkpointRef))) return;
        const checkpoints = yield* resolveCheckpoints(
          "CheckpointStore.captureCheckpoint",
          target.cwd,
        );
        yield* checkpoints.captureCheckpoint({
          cwd: target.cwd,
          checkpointRef: input.checkpointRef,
          ...(target.excludePaths.length === 0 ? {} : { excludePaths: target.excludePaths }),
        });
      }),
    );
  });

  const hasCheckpointRef: CheckpointStore["Service"]["hasCheckpointRef"] = Effect.fn(
    "hasCheckpointRef",
  )(function* (input) {
    const found = yield* forEachTarget(yield* resolveTargets(input.cwd), (target) =>
      hasRefIn(target, input.checkpointRef),
    );
    return found.every(Boolean);
  });

  const restoreCheckpoint: CheckpointStore["Service"]["restoreCheckpoint"] = Effect.fn(
    "restoreCheckpoint",
  )(function* (input) {
    const targets = yield* resolveTargets(input.cwd);
    // Refuse up front rather than restore some repositories and then find one without the ref.
    if (targets.length > 1 && input.fallbackToHead !== true) {
      const found = yield* forEachTarget(targets, (target) =>
        hasRefIn(target, input.checkpointRef),
      );
      if (!found.every(Boolean)) return false;
    }
    // One at a time, so a failure can name the repositories that were already restored.
    const restored = yield* Effect.forEach(targets, (target, index) =>
      resolveCheckpoints("CheckpointStore.restoreCheckpoint", target.cwd).pipe(
        Effect.flatMap((checkpoints) =>
          checkpoints.restoreCheckpoint({ ...input, cwd: target.cwd }),
        ),
        Effect.tapError(() =>
          index === 0
            ? Effect.void
            : Effect.logWarning("Checkpoint restore failed after restoring other repositories", {
                failed: target.cwd,
                restored: targets.slice(0, index).map((done) => done.cwd),
              }),
        ),
      ),
    );
    return restored.every(Boolean);
  });

  const diffCheckpoints: CheckpointStore["Service"]["diffCheckpoints"] = Effect.fn(
    "diffCheckpoints",
  )(function* (input) {
    const targets = yield* resolveTargets(input.cwd);
    const diffs = yield* forEachTarget(targets, (target) =>
      Effect.gen(function* () {
        const checkpoints = yield* resolveCheckpoints(
          "CheckpointStore.diffCheckpoints",
          target.cwd,
        );
        if (targets.length > 1) {
          // A repository added to the workspace after either checkpoint has nothing to compare.
          const comparable =
            (yield* checkpoints.hasCheckpointRef({
              cwd: target.cwd,
              checkpointRef: input.toCheckpointRef,
            })) &&
            (input.fallbackFromToHead === true ||
              (yield* checkpoints.hasCheckpointRef({
                cwd: target.cwd,
                checkpointRef: input.fromCheckpointRef,
              })));
          if (!comparable) return "";
        }
        const diff = yield* checkpoints.diffCheckpoints({ ...input, cwd: target.cwd });
        if (target.pathPrefix === null) return diff;
        return input.format === "numstat"
          ? prefixNumstatPaths(diff, target.pathPrefix)
          : prefixPatchPaths(diff, target.pathPrefix);
      }),
    );
    return diffs.join("");
  });

  const listAuthoredPaths: CheckpointStore["Service"]["listAuthoredPaths"] = Effect.fn(
    "listAuthoredPaths",
  )(function* (input) {
    const targets = yield* resolveTargets(input.cwd);
    if (targets.length === 1 && targets[0]!.pathPrefix === null) {
      const checkpoints = yield* resolveCheckpoints("CheckpointStore.listAuthoredPaths", input.cwd);
      return yield* checkpoints.listAuthoredPaths(input);
    }
    // Null means every changed path in that repository belongs to the work, so it contributes
    // its whole diff. The workspace answers null only when no repository moved its HEAD.
    const perTarget = yield* forEachTarget(targets, (target) =>
      Effect.gen(function* () {
        const prefixed = (path: string) => `${target.pathPrefix}/${path}`;
        const comparable =
          (yield* hasRefIn(target, input.fromCheckpointRef)) &&
          (yield* hasRefIn(target, input.toCheckpointRef));
        if (!comparable) return { authored: null, changed: [] };
        const checkpoints = yield* resolveCheckpoints(
          "CheckpointStore.listAuthoredPaths",
          target.cwd,
        );
        const authored = yield* checkpoints.listAuthoredPaths({ ...input, cwd: target.cwd });
        if (authored !== null) return { authored: Array.from(authored, prefixed), changed: [] };
        const numstat = yield* checkpoints.diffCheckpoints({
          ...input,
          cwd: target.cwd,
          ignoreWhitespace: false,
          format: "numstat",
        });
        const changed = parseTurnDiffFilesFromNumstat(numstat).flatMap((file) =>
          file.previousPath === undefined ? [file.path] : [file.path, file.previousPath],
        );
        return { authored: null, changed: changed.map(prefixed) };
      }),
    );
    if (perTarget.every((result) => result.authored === null)) return null;
    return new Set(perTarget.flatMap((result) => result.authored ?? result.changed));
  });

  const deleteCheckpointRefs: CheckpointStore["Service"]["deleteCheckpointRefs"] = Effect.fn(
    "deleteCheckpointRefs",
  )(function* (input) {
    yield* forEachTarget(yield* resolveTargets(input.cwd), (target) =>
      resolveCheckpoints("CheckpointStore.deleteCheckpointRefs", target.cwd).pipe(
        Effect.flatMap((checkpoints) =>
          checkpoints.deleteCheckpointRefs({ ...input, cwd: target.cwd }),
        ),
      ),
    );
  });

  return CheckpointStore.of({
    isCheckpointable,
    captureCheckpoint,
    hasCheckpointRef,
    restoreCheckpoint,
    diffCheckpoints,
    listAuthoredPaths,
    deleteCheckpointRefs,
  });
});

export const layer = Layer.effect(CheckpointStore, make).pipe(
  Layer.provide(WorkspaceRepositories.layer),
);
