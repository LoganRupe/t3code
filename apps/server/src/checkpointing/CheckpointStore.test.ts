// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { ThreadId, type VcsError } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import { describe, expect } from "vite-plus/test";

import { checkpointRefForThreadTurn } from "./Utils.ts";
import { parseTurnDiffFilesFromNumstat } from "./Diffs.ts";
import * as CheckpointStore from "./CheckpointStore.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ServerConfig from "../config.ts";

const ServerConfigLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-checkpoint-store-test-",
});
const VcsProcessTestLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const VcsDriverTestLayer = VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcessTestLayer));
const CheckpointStoreTestLayer = CheckpointStore.layer.pipe(
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(NodeServices.layer),
);
const TestLayer = CheckpointStoreTestLayer.pipe(
  Layer.provideMerge(VcsProcessTestLayer),
  Layer.provideMerge(VcsDriverTestLayer),
  Layer.provideMerge(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

function makeTmpDir(
  prefix = "checkpoint-store-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function writeTextFile(
  filePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(filePath, contents);
  });
}

function git(
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, VcsError, VcsProcess.VcsProcess> {
  return Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    const result = yield* process.run({
      operation: "CheckpointStore.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });
}

function initRepoWithCommit(
  cwd: string,
): Effect.Effect<
  void,
  VcsError | PlatformError.PlatformError,
  VcsProcess.VcsProcess | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    yield* git(cwd, ["init"]);
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* writeTextFile(NodePath.join(cwd, "README.md"), "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
  });
}

function buildLargeText(lineCount = 5_000): string {
  return Array.from({ length: lineCount }, (_, index) => `line ${String(index).padStart(5, "0")}`)
    .join("\n")
    .concat("\n");
}

it.layer(TestLayer)("CheckpointStore.layer", (it) => {
  describe("isCheckpointable", () => {
    it.effect("returns false when no Git repository is detected", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        const checkpointStore = yield* CheckpointStore.CheckpointStore;

        expect(yield* checkpointStore.isCheckpointable(tmp)).toBe(false);
      }),
    );

    it.effect("returns true when a Git repository is detected", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;

        expect(yield* checkpointStore.isCheckpointable(tmp)).toBe(true);
      }),
    );
  });

  it.effect("detects a nested workspace without its own .git entry", () =>
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir();
      yield* initRepoWithCommit(tmp);
      const fileSystem = yield* FileSystem.FileSystem;
      const nested = NodePath.join(tmp, "packages", "nested");
      yield* fileSystem.makeDirectory(nested, { recursive: true });
      const checkpointStore = yield* CheckpointStore.CheckpointStore;
      expect(yield* checkpointStore.isCheckpointable(nested)).toBe(true);
    }),
  );
  describe("multi-repo workspaces", () => {
    const makeWorkspace = Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* makeTmpDir("checkpoint-store-workspace-");
      for (const name of ["api", "web"]) {
        const repo = NodePath.join(workspace, name);
        yield* fileSystem.makeDirectory(repo);
        yield* initRepoWithCommit(repo);
      }
      yield* writeTextFile(NodePath.join(workspace, "NOTES.md"), "not in any repository\n");
      return workspace;
    });

    it.effect("captures, diffs and restores every repository as one workspace", () =>
      Effect.gen(function* () {
        const workspace = yield* makeWorkspace;
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-multi-repo");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        expect(yield* checkpointStore.isCheckpointable(workspace)).toBe(true);
        yield* checkpointStore.captureCheckpoint({
          cwd: workspace,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(NodePath.join(workspace, "api", "README.md"), "# api\n");
        yield* writeTextFile(NodePath.join(workspace, "web", "app.ts"), "export {};\n");
        yield* checkpointStore.captureCheckpoint({
          cwd: workspace,
          checkpointRef: toCheckpointRef,
        });

        const numstat = yield* checkpointStore.diffCheckpoints({
          cwd: workspace,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
          format: "numstat",
        });
        expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
          { path: "api/README.md", additions: 1, deletions: 1 },
          { path: "web/app.ts", additions: 1, deletions: 0 },
        ]);
        const patch = yield* checkpointStore.diffCheckpoints({
          cwd: workspace,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });
        expect(patch).toContain("diff --git a/api/README.md b/api/README.md");
        expect(patch).toContain("+++ b/web/app.ts");

        expect(
          yield* checkpointStore.restoreCheckpoint({
            cwd: workspace,
            checkpointRef: fromCheckpointRef,
          }),
        ).toBe(true);
        expect(yield* fileSystem.readFileString(NodePath.join(workspace, "api", "README.md"))).toBe(
          "# test\n",
        );
        expect(yield* fileSystem.exists(NodePath.join(workspace, "web", "app.ts"))).toBe(false);
        expect(yield* fileSystem.exists(NodePath.join(workspace, "NOTES.md"))).toBe(true);
      }),
    );

    it.effect(
      "covers the root repository and repositories the workspace file lists elsewhere",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const checkpointStore = yield* CheckpointStore.CheckpointStore;
          const elsewhere = yield* makeTmpDir("checkpoint-store-elsewhere-");
          const outsideApi = NodePath.join(elsewhere, "team-a", "api");
          yield* fileSystem.makeDirectory(outsideApi, { recursive: true });
          yield* initRepoWithCommit(outsideApi);
          // The workspace folder is a repository of its own: a context repo with the docs.
          const workspace = yield* makeTmpDir("checkpoint-store-context-");
          yield* initRepoWithCommit(workspace);
          yield* writeTextFile(
            NodePath.join(workspace, "context.code-workspace"),
            `{ "folders": [{ "path": "." }, { "path": "${outsideApi}", "name": "API" }] }`,
          );
          const threadId = ThreadId.make("thread-outside-repo");
          const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
          const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

          yield* checkpointStore.captureCheckpoint({
            cwd: workspace,
            checkpointRef: fromCheckpointRef,
          });
          yield* writeTextFile(NodePath.join(workspace, "NOTES.md"), "context\n");
          yield* writeTextFile(NodePath.join(outsideApi, "README.md"), "# api\n");
          yield* checkpointStore.captureCheckpoint({
            cwd: workspace,
            checkpointRef: toCheckpointRef,
          });

          const numstat = yield* checkpointStore.diffCheckpoints({
            cwd: workspace,
            fromCheckpointRef,
            toCheckpointRef,
            ignoreWhitespace: false,
            format: "numstat",
          });
          // Root paths stay bare; the outside repository is known by its workspace name.
          expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
            { path: "API/README.md", additions: 1, deletions: 1 },
            { path: "NOTES.md", additions: 1, deletions: 0 },
          ]);

          expect(
            yield* checkpointStore.restoreCheckpoint({
              cwd: workspace,
              checkpointRef: fromCheckpointRef,
            }),
          ).toBe(true);
          expect(yield* fileSystem.exists(NodePath.join(workspace, "NOTES.md"))).toBe(false);
          expect(yield* fileSystem.readFileString(NodePath.join(outsideApi, "README.md"))).toBe(
            "# test\n",
          );
        }),
    );

    it.effect(
      "a root repository leaves the repositories nested inside it to their own captures",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const checkpointStore = yield* CheckpointStore.CheckpointStore;
          // The layout of an isolated run: the root checkout holds the other worktrees.
          const workspace = yield* makeTmpDir("checkpoint-store-nested-root-");
          yield* initRepoWithCommit(workspace);
          yield* fileSystem.makeDirectory(NodePath.join(workspace, "api"));
          yield* initRepoWithCommit(NodePath.join(workspace, "api"));
          yield* writeTextFile(
            NodePath.join(workspace, "nested.code-workspace"),
            `{ "folders": [{ "path": "." }, { "path": "api" }] }`,
          );
          const threadId = ThreadId.make("thread-nested-root");
          const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
          const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

          yield* checkpointStore.captureCheckpoint({
            cwd: workspace,
            checkpointRef: fromCheckpointRef,
          });
          yield* writeTextFile(NodePath.join(workspace, "README.md"), "# root\n");
          yield* writeTextFile(NodePath.join(workspace, "api", "README.md"), "# api\n");
          yield* checkpointStore.captureCheckpoint({
            cwd: workspace,
            checkpointRef: toCheckpointRef,
          });

          const numstat = yield* checkpointStore.diffCheckpoints({
            cwd: workspace,
            fromCheckpointRef,
            toCheckpointRef,
            ignoreWhitespace: false,
            format: "numstat",
          });
          // Without the exclusion the root would record `api` as a subproject and list it here.
          expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
            { path: "api/README.md", additions: 1, deletions: 1 },
            { path: "README.md", additions: 1, deletions: 1 },
          ]);

          expect(
            yield* checkpointStore.restoreCheckpoint({
              cwd: workspace,
              checkpointRef: fromCheckpointRef,
            }),
          ).toBe(true);
          expect(yield* fileSystem.readFileString(NodePath.join(workspace, "README.md"))).toBe(
            "# test\n",
          );
          expect(
            yield* fileSystem.readFileString(NodePath.join(workspace, "api", "README.md")),
          ).toBe("# test\n");
        }),
    );

    it.effect("restores nothing when a repository is missing the checkpoint", () =>
      Effect.gen(function* () {
        const workspace = yield* makeWorkspace;
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-multi-repo-late-repo");
        const checkpointRef = checkpointRefForThreadTurn(threadId, 0);

        yield* checkpointStore.captureCheckpoint({ cwd: workspace, checkpointRef });
        const late = NodePath.join(workspace, "late");
        yield* fileSystem.makeDirectory(late);
        yield* initRepoWithCommit(late);
        yield* writeTextFile(NodePath.join(workspace, "api", "README.md"), "# edited\n");

        expect(yield* checkpointStore.hasCheckpointRef({ cwd: workspace, checkpointRef })).toBe(
          false,
        );
        expect(yield* checkpointStore.restoreCheckpoint({ cwd: workspace, checkpointRef })).toBe(
          false,
        );
        expect(yield* fileSystem.readFileString(NodePath.join(workspace, "api", "README.md"))).toBe(
          "# edited\n",
        );
      }),
    );
  });

  describe("diffCheckpoints", () => {
    it.effect("returns full oversized checkpoint diffs without truncation", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(NodePath.join(tmp, "README.md"), buildLargeText());
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(diff).toContain("diff --git");
        expect(diff).not.toContain("[truncated]");
        expect(diff).toContain("+line 04999");
      }),
    );

    it.effect("keeps a/ and b/ patch prefixes when the repository disables them", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* git(tmp, ["config", "diff.noprefix", "true"]);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-noprefix");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "# changed\n");
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const diff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });

        expect(diff).toContain("diff --git a/README.md b/README.md");
      }),
    );

    it.effect("can hide indentation churn when changes wrap existing lines", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("thread-checkpoint-store-whitespace");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);

        const componentPath = NodePath.join(tmp, "Component.tsx");
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      <h1>Title</h1>",
            "      <p>Body</p>",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: fromCheckpointRef,
        });
        yield* writeTextFile(
          componentPath,
          [
            "export function View() {",
            "  return (",
            "    <section>",
            "      {isReady ? (",
            "        <div>",
            "          <h1>Title</h1>",
            "          <p>Body</p>",
            "        </div>",
            "      ) : null}",
            "    </section>",
            "  );",
            "}",
            "",
          ].join("\n"),
        );
        yield* checkpointStore.captureCheckpoint({
          cwd: tmp,
          checkpointRef: toCheckpointRef,
        });

        const normalDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
        });
        const whitespaceIgnoredDiff = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: true,
        });

        expect(normalDiff).toContain("diff --git");
        expect(normalDiff).toContain("-      <h1>Title</h1>");
        expect(normalDiff).toContain("+          <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).toContain("diff --git");
        expect(whitespaceIgnoredDiff).toContain("+      {isReady ? (");
        expect(whitespaceIgnoredDiff).toContain("+        <div>");
        expect(whitespaceIgnoredDiff).not.toContain("-      <h1>Title</h1>");
        expect(whitespaceIgnoredDiff).not.toContain("+          <h1>Title</h1>");

        for (const ignoreWhitespace of [false, true]) {
          const numstat = yield* checkpointStore.diffCheckpoints({
            cwd: tmp,
            fromCheckpointRef,
            toCheckpointRef,
            ignoreWhitespace,
            format: "numstat",
          });
          expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
            {
              path: "Component.tsx",
              additions: ignoreWhitespace ? 4 : 6,
              deletions: ignoreWhitespace ? 0 : 2,
            },
          ]);
        }
      }),
    );
  });

  describe("checkpoint file summaries", () => {
    it.effect("counts changes whose full patch exceeds the output limit", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("large-checkpoint-summary");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
        const filePath = NodePath.join(tmp, "README.md");
        const lineCount = 20_000;
        yield* writeTextFile(filePath, `${"before".repeat(50)}\n`.repeat(lineCount));
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: fromCheckpointRef });
        yield* writeTextFile(filePath, `${"after".repeat(60)}\n`.repeat(lineCount));
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: toCheckpointRef });

        const numstat = yield* checkpointStore.diffCheckpoints({
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
          format: "numstat",
        });

        expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
          { path: "README.md", additions: lineCount, deletions: lineCount },
        ]);
        expect(numstat.length).toBeLessThan(100);
      }),
    );

    it.effect("preserves file paths and turn ranges without changing the user index", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        yield* git(tmp, ["config", "diff.renames", "copies"]);
        const fileSystem = yield* FileSystem.FileSystem;
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("checkpoint-summary-paths");
        const baseline = checkpointRefForThreadTurn(threadId, 0);
        const firstTurn = checkpointRefForThreadTurn(threadId, 1);
        const secondTurn = checkpointRefForThreadTurn(threadId, 2);
        const copiedText = Array.from({ length: 20 }, (_, index) => `copy line ${index}\n`).join(
          "",
        );
        const platform = yield* HostProcessPlatform;
        const renamedPath = platform === "win32" ? "renamed café.txt" : "renamed\tcafé\nname.txt";
        const addedPath = platform === "win32" ? "new café.txt" : "new\tfile\n名.txt";
        for (const [path, contents] of Object.entries({
          "copy-source.txt": copiedText,
          "deleted.txt": "delete me\n",
          "rename-old.txt": "before\nkeep one\nkeep two\nkeep three\n",
          "binary.bin": "\0before",
        })) {
          yield* writeTextFile(NodePath.join(tmp, path), contents);
        }
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: baseline });

        yield* fileSystem.rename(
          NodePath.join(tmp, "rename-old.txt"),
          NodePath.join(tmp, renamedPath),
        );
        yield* fileSystem.remove(NodePath.join(tmp, "deleted.txt"));
        for (const [path, contents] of Object.entries({
          "copy-source.txt": `${copiedText}one more\n`,
          "copied.txt": copiedText,
          [renamedPath]: "after\nkeep one\nkeep two\nkeep three\n",
          "binary.bin": "\0after",
          "empty.txt": "",
          [addedPath]: "first\nsecond\n",
        })) {
          yield* writeTextFile(NodePath.join(tmp, path), contents);
        }
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: firstTurn });
        const userIndex = yield* fileSystem.readFile(NodePath.join(tmp, ".git/index"));
        const input = {
          cwd: tmp,
          fromCheckpointRef: baseline,
          toCheckpointRef: firstTurn,
          ignoreWhitespace: false,
          format: "numstat" as const,
        };
        const firstSummary = parseTurnDiffFilesFromNumstat(
          yield* checkpointStore.diffCheckpoints(input),
        );
        const expectedFiles = [
          { path: "binary.bin", additions: 0, deletions: 0 },
          { path: "copied.txt", additions: 0, deletions: 0 },
          { path: "copy-source.txt", additions: 1, deletions: 0 },
          { path: "deleted.txt", additions: 0, deletions: 1 },
          { path: "empty.txt", additions: 0, deletions: 0 },
          { path: addedPath, additions: 2, deletions: 0 },
          { path: renamedPath, additions: 1, deletions: 1 },
        ].toSorted((left, right) => left.path.localeCompare(right.path));
        expect(firstSummary).toEqual(expectedFiles);

        yield* fileSystem.remove(NodePath.join(tmp, "empty.txt"));
        yield* writeTextFile(NodePath.join(tmp, "copy-source.txt"), "replacement\n");
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: secondTurn });
        const secondSummary = parseTurnDiffFilesFromNumstat(
          yield* checkpointStore.diffCheckpoints({
            ...input,
            fromCheckpointRef: firstTurn,
            toCheckpointRef: secondTurn,
          }),
        );
        expect(secondSummary).toEqual([
          { path: "copy-source.txt", additions: 1, deletions: 21 },
          { path: "empty.txt", additions: 0, deletions: 0 },
        ]);

        const inclusiveSummary = parseTurnDiffFilesFromNumstat(
          yield* checkpointStore.diffCheckpoints({ ...input, toCheckpointRef: secondTurn }),
        );
        expect(inclusiveSummary).toEqual(
          expectedFiles
            .filter((file) => file.path !== "empty.txt")
            .map((file) =>
              file.path === "copy-source.txt" ? { ...file, additions: 1, deletions: 20 } : file,
            ),
        );
        expect(
          yield* checkpointStore.diffCheckpoints({ ...input, toCheckpointRef: baseline }),
        ).toBe("");
        expect(yield* fileSystem.readFile(NodePath.join(tmp, ".git/index"))).toEqual(userIndex);
      }),
    );

    it.effect("uses HEAD for a missing baseline only when requested", () =>
      Effect.gen(function* () {
        const tmp = yield* makeTmpDir();
        yield* initRepoWithCommit(tmp);
        const checkpointStore = yield* CheckpointStore.CheckpointStore;
        const threadId = ThreadId.make("checkpoint-summary-fallback");
        const fromCheckpointRef = checkpointRefForThreadTurn(threadId, 0);
        const toCheckpointRef = checkpointRefForThreadTurn(threadId, 1);
        yield* writeTextFile(NodePath.join(tmp, "README.md"), "changed\n");
        yield* checkpointStore.captureCheckpoint({ cwd: tmp, checkpointRef: toCheckpointRef });
        const input = {
          cwd: tmp,
          fromCheckpointRef,
          toCheckpointRef,
          ignoreWhitespace: false,
          format: "numstat" as const,
        };

        const error = yield* Effect.flip(checkpointStore.diffCheckpoints(input));
        expect(error._tag).toBe("VcsProcessExitError");
        const numstat = yield* checkpointStore.diffCheckpoints({
          ...input,
          fallbackFromToHead: true,
        });
        expect(parseTurnDiffFilesFromNumstat(numstat)).toEqual([
          { path: "README.md", additions: 1, deletions: 1 },
        ]);
      }),
    );
  });
});
