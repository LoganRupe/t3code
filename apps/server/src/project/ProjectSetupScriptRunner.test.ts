import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it, vi } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as TerminalManager from "../terminal/Manager.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspaceRepositories from "../workspace/WorkspaceRepositories.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectSetupScriptRunner from "./ProjectSetupScriptRunner.ts";

it.effect("runs the setup script once in every repository of an isolated run", () => {
  const open = vi.fn((input: Parameters<TerminalManager.TerminalManager["Service"]["open"]>[0]) =>
    Effect.succeed({
      threadId: input.threadId,
      terminalId: input.terminalId,
      cwd: input.cwd,
      worktreePath: input.worktreePath ?? null,
      status: "running" as const,
      pid: 123,
      history: "",
      exitCode: null,
      exitSignal: null,
      label: "Shell",
      updatedAt: "2026-06-20T00:00:00.000Z",
    }),
  );
  const write = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["write"]>[0]) => Effect.void,
  );
  const closeIdle = vi.fn(
    (_input: Parameters<TerminalManager.TerminalManager["Service"]["closeIdle"]>[0]) => Effect.void,
  );
  const listeners: Array<Parameters<TerminalManager.TerminalManager["Service"]["subscribe"]>[0]> =
    [];
  const subscribe: TerminalManager.TerminalManager["Service"]["subscribe"] = (listener) =>
    Effect.sync(() => {
      listeners.push(listener);
      return () => undefined;
    });
  const projectId = ProjectId.make("project:setup-runner-multi-repo");
  const project = {
    id: projectId,
    title: "Workspace",
    workspaceRoot: "/workspace",
    repositoryIdentity: null,
    faviconPath: null,
    defaultModelSelection: null,
    scripts: [
      {
        id: "setup",
        name: "Setup",
        command: "cp $T3CODE_REPO_ROOT/.env .",
        icon: "configure" as const,
        runOnWorktreeCreate: true,
      },
    ],
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
    deletedAt: null,
  };
  const layer = ProjectSetupScriptRunner.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeed(Option.some(project)),
        }),
        Layer.mock(TerminalManager.TerminalManager)({ open, write, subscribe, closeIdle }),
        ServerSettings.layerTest(),
        NodeServices.layer,
      ),
    ),
  );

  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-setup-runner-" });
    const container = path.join(baseDir, "workspace", "t3-abc");
    yield* fileSystem.makeDirectory(container, { recursive: true });
    yield* fileSystem.writeFileString(
      WorkspaceRepositories.isolatedRunLayoutPath(container),
      JSON.stringify({
        repositories: [
          { relativePath: "api", name: "API", source: "/workspace/api" },
          { relativePath: ".", name: "workspace", source: "/workspace" },
        ],
      }),
    );
    const apiWorktree = path.join(container, "api");

    const runner = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
    const lines: string[] = [];
    const result = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: container,
      observeCompletion: {
        onOutputLine: (line) =>
          Effect.sync(() => {
            lines.push(line);
          }),
      },
    });
    assert.equal(result.status, "started");
    if (result.status !== "started") return;
    // The root repository's worktree is the container, so it keeps the plain
    // terminal id and goes first; the others get a terminal of their own.
    assert.equal(result.terminalId, "setup-setup");
    assert.equal(result.cwd, container);
    assert.deepEqual(result.repositories, [
      { name: "workspace", cwd: container, terminalId: "setup-setup" },
      { name: "API", cwd: apiWorktree, terminalId: "setup-setup-api" },
    ]);
    assert.deepEqual(
      open.mock.calls.map(([input]) => ({
        terminalId: input.terminalId,
        cwd: input.cwd,
        worktreePath: input.worktreePath,
        repoRoot: input.env?.T3CODE_REPO_ROOT,
        worktreeEnv: input.env?.T3CODE_WORKTREE_PATH,
        projectRoot: input.env?.T3CODE_PROJECT_ROOT,
      })),
      [
        {
          terminalId: "setup-setup",
          cwd: container,
          worktreePath: container,
          repoRoot: "/workspace",
          worktreeEnv: container,
          projectRoot: "/workspace",
        },
        {
          terminalId: "setup-setup-api",
          cwd: apiWorktree,
          worktreePath: container,
          repoRoot: "/workspace/api",
          worktreeEnv: apiWorktree,
          projectRoot: "/workspace",
        },
      ],
    );
    assert.equal(write.mock.calls.length, 2);

    const completion = yield* Effect.forkChild(result.completion ?? Effect.die("no completion"));
    const tokenFor = (index: number) =>
      /__T3_SETUP_DONE___(\w+):/.exec(write.mock.calls[index]?.[0].data ?? "")?.[1];
    yield* listeners[1]!({
      type: "output",
      threadId: "thread-1",
      terminalId: "setup-setup-api",
      data: `cp: .env: No such file\r\n__T3_SETUP_DONE___${tokenFor(1)}:1\r\n$ `,
    });
    yield* listeners[0]!({
      type: "output",
      threadId: "thread-1",
      terminalId: "setup-setup",
      data: `copied\r\n__T3_SETUP_DONE___${tokenFor(0)}:0\r\n$ `,
    });
    const settled = yield* Fiber.join(completion);
    // Lines say which repository they came from, and the run fails as a whole
    // when any repository does, naming each outcome.
    assert.deepEqual(lines, ["[API] cp: .env: No such file", "[workspace] copied"]);
    assert.equal(settled.exitCode, 1);
    assert.deepEqual(settled.repositories, [
      { name: "workspace", exitCode: 0 },
      { name: "API", exitCode: 1 },
    ]);
    // Only the clean run's shell is closed; the failed one stays open for a look.
    assert.deepEqual(
      closeIdle.mock.calls.map(([input]) => input.terminalId),
      ["setup-setup"],
    );

    // A repository added to the run later gets the script in its worktree alone.
    open.mockClear();
    const added = yield* runner.runForThread({
      threadId: "thread-1",
      projectId,
      worktreePath: container,
      onlyRepository: "api",
    });
    assert.equal(added.status, "started");
    assert.deepEqual(
      open.mock.calls.map(([input]) => input.terminalId),
      ["setup-setup-api"],
    );
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(layer, NodeServices.layer)));
});

it("keeps long repository terminal ids distinct within the terminal id limit", () => {
  const prefix = "service-".repeat(20);
  const api = ProjectSetupScriptRunner.repositoryTerminalId("setup-setup", `${prefix}api`);
  const web = ProjectSetupScriptRunner.repositoryTerminalId("setup-setup", `${prefix}web`);
  assert.notEqual(api, web);
  assert.isAtMost(api.length, 128);
  assert.isAtMost(web.length, 128);
  assert.equal(
    ProjectSetupScriptRunner.repositoryTerminalId("setup-setup", "packages/api"),
    "setup-setup-packages-api",
  );
});
