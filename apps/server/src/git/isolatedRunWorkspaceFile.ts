/**
 * The `.code-workspace` file an editor opens for an isolated run of a project that has one.
 *
 * The container holds the run's worktrees, but opened as a plain folder it loses what the
 * project's workspace file gives: repositories outside the project and the names the file uses.
 * So the run gets a copy of the project's file, written beside the container, with each
 * repository's folder pointed at its worktree and every other folder at the project's copy.
 * Settings, tasks and anything else in the file carry over unchanged.
 *
 * @module isolatedRunWorkspaceFile
 */
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as WorkspaceRepositories from "../workspace/WorkspaceRepositories.ts";

const WorkspaceDocument = Schema.Record(Schema.String, Schema.Unknown);
const decodeDocument = Schema.decodeUnknownEffect(fromLenientJson(WorkspaceDocument));
const encodeDocument = Schema.encodeEffect(fromJsonStringPretty(WorkspaceDocument));
const isFolder = Schema.is(
  Schema.Struct({ path: Schema.String, name: Schema.optional(Schema.String) }),
);

export const writeIsolatedRunWorkspaceFile = Effect.fn("writeIsolatedRunWorkspaceFile")(
  function* (input: {
    /** The project's `.code-workspace` file. */
    readonly projectWorkspaceFile: string;
    readonly container: string;
    /** Each repository's checkout in the project and its worktree in the container. */
    readonly repositories: ReadonlyArray<{ readonly source: string; readonly worktree: string }>;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const document = yield* fileSystem
      .readFileString(input.projectWorkspaceFile)
      .pipe(Effect.flatMap(decodeDocument));
    const projectRoot = path.dirname(input.projectWorkspaceFile);
    // Repository paths come from discovery, which resolves a symlinked project folder's
    // siblings beside its target, so a folder matches either way.
    const realProjectRoot = yield* fileSystem
      .realPath(projectRoot)
      .pipe(Effect.orElseSucceed(() => projectRoot));
    const folders = (Array.isArray(document.folders) ? document.folders : []).map(
      (folder: unknown) => {
        if (!isFolder(folder)) return folder;
        const lexical = path.resolve(projectRoot, folder.path);
        const physical = path.resolve(realProjectRoot, folder.path);
        const repository = input.repositories.find(
          (candidate) => candidate.source === lexical || candidate.source === physical,
        );
        if (repository === undefined) return { ...folder, path: lexical };
        // Keep the name the project shows rather than the worktree's folder name.
        return {
          ...folder,
          path: repository.worktree,
          name: folder.name ?? path.basename(repository.source),
        };
      },
    );
    const target = WorkspaceRepositories.isolatedRunWorkspaceFilePath(input.container);
    const contents = yield* encodeDocument({ ...document, folders });
    yield* fileSystem.writeFileString(target, `${contents}\n`);
    return target;
  },
);
