import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CommandId, type OrchestrationV2ServerCommand, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../../config.ts";
import * as WorkspaceWorktrees from "../../git/WorkspaceWorktrees.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import * as WorkspaceRepositories from "../../workspace/WorkspaceRepositories.ts";
import * as ThreadManagement from "../ThreadManagementService.ts";
import { repairMultiRepoForkWorktrees } from "./repairMultiRepoForkWorktrees.ts";

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(VcsProcess.VcsProcess, (process) =>
    process.run({ operation: "repairMultiRepoForkWorktrees.test", command: "git", cwd, args }),
  );

const initRepository = Effect.fn("initRepository")(function* (cwd: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  yield* fileSystem.makeDirectory(cwd, { recursive: true });
  yield* git(cwd, ["init", "--initial-branch=main"]);
  yield* git(cwd, ["config", "user.email", "test@test.com"]);
  yield* git(cwd, ["config", "user.name", "Test"]);
  yield* fileSystem.writeFileString(`${cwd}/README.md`, "# test\n");
  yield* git(cwd, ["add", "."]);
  yield* git(cwd, ["commit", "-m", "initial commit"]);
});

const insertThread = Effect.fn("insertThread")(function* (input: {
  readonly threadId: string;
  readonly v1WorktreePath: string;
  readonly v2WorktreePath: string;
  readonly worktrees: ReadonlyArray<{ readonly repoRoot: string; readonly worktreePath: string }>;
}) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_threads (thread_id, worktree_path, worktrees_json)
    VALUES (${input.threadId}, ${input.v1WorktreePath}, ${JSON.stringify(input.worktrees)})
  `;
  yield* sql`
    INSERT INTO orchestration_v2_projection_threads (thread_id, deleted_at, payload_json)
    VALUES (
      ${input.threadId},
      NULL,
      ${JSON.stringify({ worktreePath: input.v2WorktreePath })}
    )
  `;
});

it.effect("moves fork threads still on their first repository to the whole isolated run", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fork-worktrees-" });
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const layer = Layer.mergeAll(
      WorkspaceWorktrees.layer,
      WorkspaceRepositories.layer,
      Layer.mock(ThreadManagement.ThreadManagementService)({
        dispatch: (command) => {
          dispatched.push(command);
          return Effect.succeed({ sequence: dispatched.length, storedEvents: [] });
        },
      }),
      NodeSqliteClient.layer({ filename: ":memory:" }),
    ).pipe(
      Layer.provideMerge(GitVcsDriver.layer),
      Layer.provideMerge(VcsProcess.layer),
      Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
      Layer.provideMerge(NodeServices.layer),
    );

    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const config = yield* ServerConfig.ServerConfig;
      yield* sql`
        CREATE TABLE projection_threads (
          thread_id TEXT PRIMARY KEY,
          worktree_path TEXT,
          worktrees_json TEXT NOT NULL DEFAULT '[]'
        )
      `;
      yield* sql`
        CREATE TABLE orchestration_v2_projection_threads (
          thread_id TEXT PRIMARY KEY,
          deleted_at TEXT,
          payload_json TEXT NOT NULL
        )
      `;

      const api = path.join(baseDir, "repos", "api");
      const web = path.join(baseDir, "repos", "web");
      yield* initRepository(api);
      yield* initRepository(web);
      // The fork's layout: `<worktrees>/<project>/<thread>/<repository>`.
      const container = path.join(config.worktreesDir, "project-1", "thread-1");
      const worktrees = [
        { repoRoot: api, worktreePath: path.join(container, "api") },
        { repoRoot: web, worktreePath: path.join(container, "web") },
      ];
      for (const worktree of worktrees) {
        yield* git(worktree.repoRoot, [
          "worktree",
          "add",
          "-b",
          "t3code/thread-1",
          worktree.worktreePath,
        ]);
      }
      yield* insertThread({
        threadId: "thread-1",
        v1WorktreePath: worktrees[0]!.worktreePath,
        v2WorktreePath: worktrees[0]!.worktreePath,
        worktrees,
      });
      // Moved after the import, so it is left alone.
      yield* insertThread({
        threadId: "thread-moved",
        v1WorktreePath: worktrees[0]!.worktreePath,
        v2WorktreePath: path.join(config.worktreesDir, "elsewhere"),
        worktrees,
      });
      // An ordinary single-repository isolated run.
      yield* insertThread({
        threadId: "thread-single",
        v1WorktreePath: worktrees[1]!.worktreePath,
        v2WorktreePath: worktrees[1]!.worktreePath,
        worktrees: [worktrees[1]!],
      });

      assert.strictEqual(yield* repairMultiRepoForkWorktrees(), 1);
      assert.deepStrictEqual(dispatched, [
        {
          type: "thread.metadata.update",
          commandId: CommandId.make("migration:v1:multi-repo-worktrees:thread-1"),
          threadId: ThreadId.make("thread-1"),
          worktreePath: container,
          expectedWorktreePath: worktrees[0]!.worktreePath,
        },
      ]);

      const repositories = yield* (yield* WorkspaceRepositories.WorkspaceRepositories).list(
        container,
      );
      assert.deepStrictEqual(
        repositories.map((repository) => [repository.relativePath, repository.path]),
        [
          ["api", path.join(container, "api")],
          ["web", path.join(container, "web")],
        ],
      );

      // Thread deletion can now clean the run up.
      const workspaceWorktrees = yield* WorkspaceWorktrees.WorkspaceWorktrees;
      assert.isTrue(yield* workspaceWorktrees.isContainer(container));
      yield* workspaceWorktrees.remove({ path: container, force: false });
      assert.isFalse(yield* fileSystem.exists(container));
      assert.isFalse(
        yield* fileSystem.exists(WorkspaceRepositories.isolatedRunLayoutPath(container)),
      );
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("does nothing on databases that never ran the fork", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fork-worktrees-" });
    yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE projection_threads (thread_id TEXT PRIMARY KEY, worktree_path TEXT)`;
      assert.strictEqual(yield* repairMultiRepoForkWorktrees(), 0);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          NodeSqliteClient.layer({ filename: ":memory:" }),
          Layer.mock(ThreadManagement.ThreadManagementService)({}),
          ServerConfig.layerTest(baseDir, baseDir),
        ).pipe(Layer.provideMerge(NodeServices.layer)),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
