/**
 * WorkspaceRepositories - finds the Git repositories a multi-repo workspace folder holds.
 *
 * A project or isolated-run folder can hold several repositories: a wrapper folder with one
 * checkout per repository. A `.code-workspace` file in the folder decides which folders count,
 * and those may be the folder itself (`.`) or sit outside it (`../../team/api`), the way VS
 * Code multi-root workspaces work. Without a workspace file, only a folder that is not itself
 * inside a repository is scanned, and only its immediate child directories with a `.git` entry
 * count. Nothing outside the folder is ever scanned.
 *
 * Discovery reads only the filesystem and treats anything unreadable as absent, so callers on
 * hot paths (checkpoints, session start) can rely on it without handling failures.
 *
 * @module WorkspaceRepositories
 */
import type { VcsRepository } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

const CODE_WORKSPACE_EXTENSION = ".code-workspace";

const CodeWorkspaceDocument = Schema.Struct({
  folders: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        name: Schema.optional(Schema.String),
      }),
    ),
  ),
});
const decodeCodeWorkspace = Schema.decodeUnknownEffect(fromLenientJson(CodeWorkspaceDocument));

export interface WorkspaceLayout {
  readonly repositories: ReadonlyArray<VcsRepository>;
  /** Paths, relative to the workspace, of every folder the workspace file names. */
  readonly listedFolders: ReadonlyArray<string> | null;
}

const NOT_A_WORKSPACE: WorkspaceLayout = { repositories: [], listedFolders: null };

export class WorkspaceRepositories extends Context.Service<
  WorkspaceRepositories,
  {
    /** Repositories under `cwd`; empty when `cwd` is inside a repository or holds none. */
    readonly list: (cwd: string) => Effect.Effect<ReadonlyArray<VcsRepository>>;
    /** `list`, plus the folders a `.code-workspace` file names, or null without one. */
    readonly describe: (cwd: string) => Effect.Effect<WorkspaceLayout>;
  }
>()("t3/workspace/WorkspaceRepositories") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));
  const isDirectory = (target: string) =>
    fileSystem.stat(target).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );
  // A `.git` directory for a clone, or a `.git` file for a worktree or submodule.
  const hasGitEntry = (directory: string) => exists(path.join(directory, ".git"));

  const isInsideRepository = Effect.fn("WorkspaceRepositories.isInsideRepository")(function* (
    cwd: string,
  ) {
    let directory = cwd;
    while (true) {
      if (yield* hasGitEntry(directory)) return true;
      const parent = path.dirname(directory);
      if (parent === directory) return false;
      directory = parent;
    }
  });

  // `.` for the folder itself, `../x` for a folder outside it; a folder on another Windows
  // drive has no relative path and keeps its absolute one.
  const toRelativePath = (cwd: string, target: string) => {
    const relative = path.relative(cwd, target);
    if (relative === "") return ".";
    return relative.split(path.sep).join("/");
  };

  const fromCodeWorkspace = Effect.fn("WorkspaceRepositories.fromCodeWorkspace")(function* (
    cwd: string,
    workspaceFile: string,
  ) {
    const document = yield* fileSystem
      .readFileString(path.join(cwd, workspaceFile))
      .pipe(Effect.flatMap(decodeCodeWorkspace));
    const repositories: Array<VcsRepository> = [];
    const listedFolders: Array<string> = [];
    for (const folder of document.folders ?? []) {
      const absolutePath = path.resolve(cwd, folder.path);
      const relativePath = toRelativePath(cwd, absolutePath);
      if (listedFolders.includes(relativePath)) continue;
      listedFolders.push(relativePath);
      if (!(yield* hasGitEntry(absolutePath))) continue;
      repositories.push({
        relativePath,
        name: folder.name?.trim() || path.basename(absolutePath),
        path: absolutePath,
      });
    }
    // A workspace file that only names the folder itself describes an ordinary checkout.
    const onlyRoot = repositories.length === 1 && repositories[0]!.relativePath === ".";
    return {
      repositories: onlyRoot ? [] : repositories,
      listedFolders,
    } satisfies WorkspaceLayout;
  });

  // A scan never follows a link out of the folder: a child that resolves elsewhere is skipped,
  // since only a workspace file can name a repository outside the folder.
  const fromChildDirectories = Effect.fn("WorkspaceRepositories.fromChildDirectories")(function* (
    cwd: string,
    names: ReadonlyArray<string>,
  ) {
    const realRoot = yield* fileSystem.realPath(cwd).pipe(Effect.orElseSucceed(() => cwd));
    const staysInside = (target: string) =>
      fileSystem.realPath(target).pipe(
        Effect.map((realTarget) => toRelativePath(realRoot, realTarget) === path.basename(target)),
        Effect.orElseSucceed(() => false),
      );
    const repositories: Array<VcsRepository> = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const absolutePath = path.join(cwd, name);
      if (
        (yield* isDirectory(absolutePath)) &&
        (yield* hasGitEntry(absolutePath)) &&
        (yield* staysInside(absolutePath))
      ) {
        repositories.push({ relativePath: name, name, path: absolutePath });
      }
    }
    return repositories;
  });

  const describe = Effect.fn("WorkspaceRepositories.describe")(function* (cwd: string) {
    const names = (yield* fileSystem
      .readDirectory(cwd)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))).toSorted();
    const workspaceFiles = names.filter((name) => name.endsWith(CODE_WORKSPACE_EXTENSION));
    // With several workspace files there is no single answer, so fall back to the folder layout.
    if (workspaceFiles.length === 1) {
      const fromFile = yield* fromCodeWorkspace(cwd, workspaceFiles[0]!).pipe(Effect.option);
      if (fromFile._tag === "Some") return fromFile.value;
      yield* Effect.logWarning("Ignoring unreadable workspace file", {
        cwd,
        workspaceFile: workspaceFiles[0],
      });
    }
    if (yield* isInsideRepository(cwd)) return NOT_A_WORKSPACE;
    const repositories = yield* fromChildDirectories(cwd, names);
    return { repositories, listedFolders: null } satisfies WorkspaceLayout;
  });

  const list = (cwd: string) => describe(cwd).pipe(Effect.map((layout) => layout.repositories));

  return WorkspaceRepositories.of({ list, describe });
});

export const layer = Layer.effect(WorkspaceRepositories, make);
