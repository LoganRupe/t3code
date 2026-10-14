/**
 * Points threads imported from the pre-V2 multi-repo fork at their whole isolated run.
 *
 * The fork gave an isolated run one worktree per repository under `<worktrees>/<project>/<thread>`
 * and recorded them in `projection_threads.worktrees_json`, but its `worktree_path` named only
 * the first repository's worktree. The V2 import copies `worktree_path`, so those threads came
 * across as single-repo threads. That per-thread folder already has V2's container layout, so
 * this writes the container's layout file and moves the thread's worktree path up to it.
 *
 * Fork-only; not intended for upstream.
 *
 * @module repairMultiRepoForkWorktrees
 */
import { CommandId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import { writeIsolatedRunWorkspaceFile } from "../../git/isolatedRunWorkspaceFile.ts";
import * as WorkspaceRepositories from "../../workspace/WorkspaceRepositories.ts";
import * as ThreadManagement from "../ThreadManagementService.ts";

const ForkWorktrees = Schema.Array(
  Schema.Struct({ repoRoot: Schema.String, worktreePath: Schema.String }),
);
const decodeForkWorktrees = Schema.decodeUnknownOption(Schema.fromJsonString(ForkWorktrees));
const encodeLayout = Schema.encodeEffect(
  Schema.fromJsonString(WorkspaceRepositories.IsolatedRunLayout),
);

interface CandidateRow {
  readonly thread_id: string;
  readonly worktree_path: string;
  readonly worktrees_json: string;
}

/** Repairs every affected thread that still has its imported worktree path; returns how many. */
export const repairMultiRepoForkWorktrees = Effect.fn("repairMultiRepoForkWorktrees")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const threads = yield* ThreadManagement.ThreadManagementService;

  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  if (!columns.some((column) => column.name === "worktrees_json")) return 0;

  // A thread whose V2 worktree path moved since the import has been handled already, or the
  // user moved it, so only threads still on the imported path are candidates.
  const rows = yield* sql<CandidateRow>`
    SELECT thread.thread_id, thread.worktree_path, thread.worktrees_json
    FROM projection_threads AS thread
    INNER JOIN orchestration_v2_projection_threads AS projection
      ON projection.thread_id = thread.thread_id
    WHERE projection.deleted_at IS NULL
      AND thread.worktree_path IS NOT NULL
      AND json_extract(projection.payload_json, '$.worktreePath') = thread.worktree_path
      AND CASE WHEN json_valid(thread.worktrees_json)
        THEN json_array_length(thread.worktrees_json) ELSE 0 END > 1
  `;

  let repaired = 0;
  for (const row of rows) {
    const worktrees = decodeForkWorktrees(row.worktrees_json);
    if (worktrees._tag === "None") continue;
    const container = path.dirname(row.worktree_path);
    const relativeToWorktrees = path.relative(config.worktreesDir, container);
    const isRepairable =
      relativeToWorktrees !== "" &&
      !relativeToWorktrees.startsWith("..") &&
      !path.isAbsolute(relativeToWorktrees) &&
      worktrees.value.some((worktree) => worktree.worktreePath === row.worktree_path) &&
      worktrees.value.every((worktree) => path.dirname(worktree.worktreePath) === container) &&
      (yield* fileSystem.exists(container).pipe(Effect.orElseSucceed(() => false)));
    if (!isRepairable) continue;

    yield* Effect.gen(function* () {
      // The layout file is what V2 discovery and thread deletion read, so it goes first.
      const layoutPath = WorkspaceRepositories.isolatedRunLayoutPath(container);
      if (!(yield* fileSystem.exists(layoutPath))) {
        const contents = yield* encodeLayout({
          repositories: worktrees.value.map((worktree) => ({
            relativePath: path.basename(worktree.worktreePath),
            name: path.basename(worktree.worktreePath),
            source: worktree.repoRoot,
          })),
        });
        yield* fileSystem.writeFileString(layoutPath, contents);
      }
      yield* threads.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make(`migration:v1:multi-repo-worktrees:${row.thread_id}`),
        threadId: ThreadId.make(row.thread_id),
        worktreePath: container,
        expectedWorktreePath: row.worktree_path,
      });
      repaired += 1;
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not repair a multi-repo fork thread's worktree path", {
          threadId: row.thread_id,
          cause,
        }),
      ),
    );
  }
  return repaired;
});

/**
 * Gives repaired fork threads the workspace file V2 writes beside a new isolated run.
 *
 * The fork kept its copy inside the container, so V2's "Open in" fell back to the bare folder.
 * This writes V2's own file from the project's workspace file. The fork's copy stays, because
 * the pre-V2 build opens it and a database can still go back to that build. Threads that
 * already have the file are skipped, so this runs once per thread.
 */
export const writeMultiRepoForkWorkspaceFiles = Effect.fn("writeMultiRepoForkWorkspaceFiles")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workspaceRepositories = yield* WorkspaceRepositories.WorkspaceRepositories;

    const rows = yield* sql<{
      readonly thread_id: string;
      readonly worktree_path: string;
      readonly workspace_root: string;
    }>`
      SELECT
        thread.thread_id,
        json_extract(thread.payload_json, '$.worktreePath') AS worktree_path,
        project.workspace_root
      FROM orchestration_v2_projection_threads AS thread
      INNER JOIN projection_projects AS project ON project.project_id = thread.project_id
      WHERE thread.deleted_at IS NULL
        AND json_extract(thread.payload_json, '$.worktreePath') IS NOT NULL
    `;

    // Only the fork left a real workspace file in a container; V2 links the project's in.
    const holdsForkCopy = (container: string) =>
      fileSystem.readDirectory(container).pipe(
        Effect.flatMap((names) => {
          const held = names.filter((name) =>
            name.endsWith(WorkspaceRepositories.CODE_WORKSPACE_EXTENSION),
          );
          if (held.length !== 1) return Effect.succeed(false);
          return fileSystem.readLink(path.join(container, held[0]!)).pipe(
            Effect.as(false),
            Effect.orElseSucceed(() => true),
          );
        }),
        Effect.orElseSucceed(() => false),
      );

    let written = 0;
    for (const row of rows) {
      const container = row.worktree_path;
      const target = WorkspaceRepositories.isolatedRunWorkspaceFilePath(container);
      if (yield* fileSystem.exists(target).pipe(Effect.orElseSucceed(() => true))) continue;
      const layout = yield* workspaceRepositories.readIsolatedRun(container);
      if (layout === null || !(yield* holdsForkCopy(container))) continue;
      const projectWorkspaceFile = yield* workspaceRepositories.workspaceFile(row.workspace_root);
      if (projectWorkspaceFile === null) continue;

      yield* writeIsolatedRunWorkspaceFile({
        projectWorkspaceFile,
        container,
        repositories: layout.repositories.map((repository) => ({
          source: repository.source,
          worktree: path.resolve(container, repository.relativePath),
        })),
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            written += 1;
          }),
        ),
        Effect.catch((cause) =>
          Effect.logWarning("Could not write a multi-repo fork thread's workspace file", {
            threadId: row.thread_id,
            cause,
          }),
        ),
      );
    }
    return written;
  },
);
