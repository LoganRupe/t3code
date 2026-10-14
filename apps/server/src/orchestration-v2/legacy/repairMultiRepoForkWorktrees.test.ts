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
import {
  repairMultiRepoForkWorktrees,
  writeMultiRepoForkWorkspaceFiles,
} from "./repairMultiRepoForkWorktrees.ts";

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

const workspaceFileLayer = NodeSqliteClient.layer({ filename: ":memory:" }).pipe(
  Layer.merge(WorkspaceRepositories.layer),
  Layer.provideMerge(NodeServices.layer),
);

const forkWorkspace = JSON.stringify({
  folders: [
    { path: "./api", name: "api" },
    { path: "./web", name: "web" },
  ],
});

/** A project with `api` and `web`, and a thread's container recorded in V2 at `container`. */
const makeForkThread = Effect.fn("makeForkThread")(function* (input: {
  readonly threadId: string;
  readonly projectRoot: string;
  readonly container: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  for (const name of ["api", "web"]) {
    yield* fileSystem.makeDirectory(path.join(input.projectRoot, name, ".git"), {
      recursive: true,
    });
    yield* fileSystem.makeDirectory(path.join(input.container, name), { recursive: true });
  }
  yield* fileSystem.writeFileString(
    path.join(input.projectRoot, "team.code-workspace"),
    forkWorkspace,
  );
  yield* fileSystem.writeFileString(
    WorkspaceRepositories.isolatedRunLayoutPath(input.container),
    JSON.stringify({
      repositories: ["api", "web"].map((name) => ({
        relativePath: name,
        name,
        source: path.join(input.projectRoot, name),
      })),
    }),
  );
  yield* sql`
    INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, deleted_at, payload_json)
    VALUES (
      ${input.threadId},
      ${input.threadId},
      NULL,
      ${JSON.stringify({ worktreePath: input.container })}
    )
  `;
  yield* sql`
    INSERT INTO projection_projects (project_id, workspace_root)
    VALUES (${input.threadId}, ${input.projectRoot})
  `;
});

const createWorkspaceFileTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE orchestration_v2_projection_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      deleted_at TEXT,
      payload_json TEXT NOT NULL
    )
  `;
  yield* sql`CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, workspace_root TEXT)`;
});

it.effect("writes V2's workspace file for fork threads and keeps the fork's copy", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fork-workspace-" });
    const projectRoot = path.join(baseDir, "team");
    const container = path.join(baseDir, "worktrees", "project-1", "thread-1");
    yield* createWorkspaceFileTables;
    yield* makeForkThread({ threadId: "thread-1", projectRoot, container });
    // The fork's copy inside the container, pointed at the worktrees.
    const forkCopy = path.join(container, "team.code-workspace");
    yield* fileSystem.writeFileString(forkCopy, forkWorkspace);

    assert.strictEqual(yield* writeMultiRepoForkWorkspaceFiles(), 1);

    const written = JSON.parse(
      yield* fileSystem.readFileString(
        WorkspaceRepositories.isolatedRunWorkspaceFilePath(container),
      ),
    );
    assert.deepStrictEqual(written.folders, [
      { path: path.join(container, "api"), name: "api" },
      { path: path.join(container, "web"), name: "web" },
    ]);
    // The pre-V2 build opens the fork's copy, so it stays as it was.
    assert.strictEqual(yield* fileSystem.readFileString(forkCopy), forkWorkspace);
    const service = yield* WorkspaceRepositories.WorkspaceRepositories;
    assert.strictEqual(
      yield* service.workspaceFile(container),
      WorkspaceRepositories.isolatedRunWorkspaceFilePath(container),
    );

    assert.strictEqual(yield* writeMultiRepoForkWorkspaceFiles(), 0);
  }).pipe(Effect.provide(workspaceFileLayer)),
);

it.effect("leaves V2 isolated runs that link the project's workspace file alone", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-fork-workspace-" });
    const projectRoot = path.join(baseDir, "team");
    const container = path.join(baseDir, "worktrees", "project-1", "thread-1");
    yield* createWorkspaceFileTables;
    yield* makeForkThread({ threadId: "thread-1", projectRoot, container });
    yield* fileSystem.symlink(
      path.join(projectRoot, "team.code-workspace"),
      path.join(container, "team.code-workspace"),
    );

    assert.strictEqual(yield* writeMultiRepoForkWorkspaceFiles(), 0);
    assert.isFalse(
      yield* fileSystem.exists(WorkspaceRepositories.isolatedRunWorkspaceFilePath(container)),
    );
  }).pipe(Effect.provide(workspaceFileLayer)),
);
