import { ProjectId, type ProjectScript } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  projectScriptRuntimeEnv,
  projectScriptTerminalInput,
  resolveProjectScripts,
  settleProjectScript,
  setupProjectScript,
} from "@t3tools/shared/projectScripts";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as WorkspaceRepositories from "../workspace/WorkspaceRepositories.ts";
import * as ProjectService from "./ProjectService.ts";

export interface ProjectSetupScriptRunnerResultNoScript {
  readonly status: "no-script";
}

export interface ProjectSetupScriptRunnerResultStarted {
  readonly status: "started";
  readonly scriptId: string;
  readonly scriptName: string;
  readonly scriptCommand: string;
  readonly terminalId: string;
  readonly cwd: string;
  readonly async: boolean;
  /**
   * The exit code is null when the terminal exited or was closed before the sentinel arrived.
   * In an isolated run of several repositories it resolves once every
   * repository's run has, and reports each one under `repositories`.
   */
  readonly completion?: Effect.Effect<ProjectSetupScriptCompletion>;
  /**
   * One entry per repository when the worktree is an isolated run of a
   * multi-repo workspace: the script ran once in each repository's worktree,
   * in its own terminal. `terminalId` and `cwd` above are the first entry's.
   * Absent for a single checkout.
   */
  readonly repositories?: ReadonlyArray<ProjectSetupScriptRepositoryRun>;
}

export interface ProjectSetupScriptRepositoryRun {
  readonly name: string;
  readonly cwd: string;
  readonly terminalId: string;
}

export interface ProjectSetupScriptCompletion {
  /** 0 only when every run exited with 0; otherwise the first failing run's code. */
  readonly exitCode: number | null;
  readonly durationMs: number;
  /** Each repository's own exit, in the order the script was started. */
  readonly repositories?: ReadonlyArray<{
    readonly name: string;
    readonly exitCode: number | null;
  }>;
}

export interface ProjectSetupScriptOutputLine {
  readonly line: string;
}

export type ProjectSetupScriptRunnerResult =
  | ProjectSetupScriptRunnerResultNoScript
  | ProjectSetupScriptRunnerResultStarted;

export interface ProjectSetupScriptRunnerInput {
  readonly threadId: string;
  readonly projectId?: string;
  readonly projectCwd?: string;
  readonly worktreePath: string;
  readonly preferredTerminalId?: string;
  readonly trigger?: "setup" | "settle";
  readonly project?: {
    readonly id: ProjectId;
    readonly workspaceRoot: string;
    readonly scripts: ReadonlyArray<ProjectScript>;
  };
  readonly observeCompletion?: {
    readonly onOutputLine?: (line: string) => Effect.Effect<void>;
  };
}

export class ProjectSetupScriptOperationError extends Schema.TaggedError<ProjectSetupScriptOperationError>()(
  "ProjectSetupScriptOperationError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
    operation: Schema.Literals(["resolveProject", "readSettings", "openTerminal", "writeCommand"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project setup script operation '${this.operation}' failed for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export class ProjectSetupScriptProjectNotFoundError extends Schema.TaggedError<ProjectSetupScriptProjectNotFoundError>()(
  "ProjectSetupScriptProjectNotFoundError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
  },
) {
  override get message(): string {
    return `Project was not found for setup script execution for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export const ProjectSetupScriptRunnerError = Schema.Union([
  ProjectSetupScriptOperationError,
  ProjectSetupScriptProjectNotFoundError,
]);
export type ProjectSetupScriptRunnerError = typeof ProjectSetupScriptRunnerError.Type;

export class ProjectSetupScriptRunner extends Context.Service<
  ProjectSetupScriptRunner,
  {
    readonly runForThread: (
      input: ProjectSetupScriptRunnerInput,
    ) => Effect.Effect<ProjectSetupScriptRunnerResult, ProjectSetupScriptRunnerError>;
  }
>()("t3/project/ProjectSetupScriptRunner") {}

/** @public Service construction is part of the canonical Effect module API. */
/**
 * Each run gets its own random token so script output cannot spoof completion, and the sentinel
 * pattern is built per run from it.
 */
const COMPLETION_SENTINEL_PREFIX = "__T3_SETUP_DONE__";
const OUTPUT_LINE_MAX_LENGTH = 400;
const PARTIAL_LINE_MAX_LENGTH = 4_096;

function completionSentinel(token: string): string {
  return `${COMPLETION_SENTINEL_PREFIX}_${token}:`;
}

function completionSentinelPattern(token: string): RegExp {
  return new RegExp(`${COMPLETION_SENTINEL_PREFIX}_${token}:(-?\\d+)`);
}

function stripTerminalControl(text: string): string {
  return (
    text
      .replace(
        // eslint-disable-next-line no-control-regex -- ANSI escape sequences start with ESC.
        /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]/g,
        "",
      )
      // eslint-disable-next-line no-control-regex -- removing control characters is the point.
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
  );
}

type CompletionShell = "posix" | "fish" | "powershell";

function resolveCompletionShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): CompletionShell {
  if (platform === "win32") return "powershell";
  const shell = env.SHELL ?? "";
  const name = shell.split("/").at(-1) ?? shell;
  if (name === "fish") return "fish";
  if (name === "pwsh" || name === "powershell") return "powershell";
  return "posix";
}

/**
 * The command runs inside a block and the block closes on its own line, so a trailing `# comment`
 * or a heredoc terminator in the command cannot swallow the sentinel. The shell reads the whole
 * block before running any of it, so a script that reads stdin cannot consume the sentinel line
 * either.
 */
function wrapCommandForCompletion(
  command: string,
  shell: CompletionShell,
  sentinel: string,
): string {
  const body = command.replace(/\r?\n/g, "\r");
  switch (shell) {
    case "powershell":
      return `$global:LASTEXITCODE = $null; & {\r${body}\r}; if ($null -ne $LASTEXITCODE) { $__t3c = $LASTEXITCODE } elseif ($?) { $__t3c = 0 } else { $__t3c = 1 }; Write-Host "${sentinel}$__t3c"`;
    case "fish":
      return `begin\r${body}\rend; printf '\\n${sentinel}%s\\n' $status`;
    case "posix":
      return `( ${body}\r); printf '\\n${sentinel}%s\\n' "$?"`;
  }
}

const TERMINAL_ID_MAX_LENGTH = 128;

/**
 * The terminal id for one repository's run of a script, within the terminal
 * id limit. An id that would run over it keeps a hash of the whole, so two
 * repositories whose paths differ only past the limit still get their own
 * terminal instead of one stopping the other's script.
 */
export function repositoryTerminalId(baseTerminalId: string, repositoryPath: string): string {
  const id = `${baseTerminalId}-${repositoryPath.replace(/[\\/]/g, "-")}`;
  if (id.length <= TERMINAL_ID_MAX_LENGTH) return id;
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  const digest = hash.toString(16).padStart(8, "0");
  return `${id.slice(0, TERMINAL_ID_MAX_LENGTH - digest.length - 1)}-${digest}`;
}

/** Where one run of the script goes: a checkout, and the repository it belongs to. */
interface ScriptTarget {
  readonly cwd: string;
  readonly terminalId: string;
  /** The repository's name, when the script runs once per repository. */
  readonly name: string | null;
  /** The original checkout the worktree came from, exposed as `T3CODE_REPO_ROOT`. */
  readonly repoRoot: string | null;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const terminalManager = yield* TerminalManager.TerminalManager;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const workspaceRepositories = yield* WorkspaceRepositories.WorkspaceRepositories;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const completionShell = resolveCompletionShell(
    yield* HostProcess.Platform,
    yield* HostProcess.Environment,
  );

  const observeTerminalCompletion = Effect.fn("ProjectSetupScriptRunner.observeTerminalCompletion")(
    function* (input: {
      readonly threadId: string;
      readonly terminalId: string;
      readonly sentinel: string;
      readonly sentinelPattern: RegExp;
      /** The shell echoes typed input; lines ending with these are the wrapper, not output. */
      readonly echoedWrapperLines: ReadonlyArray<string>;
      readonly onOutputLine: ((line: string) => Effect.Effect<void>) | undefined;
    }) {
      const startedAtMs = yield* Clock.currentTimeMillis;
      const done = yield* Deferred.make<ProjectSetupScriptCompletion>();
      // The shell redraws its prompt just after the sentinel. Closing before
      // that would read the redraw as new activity and keep an idle shell.
      const promptReturned = yield* Deferred.make<void>();
      let lineBuffer = "";
      let settled = false;

      const settle = (exitCode: number | null) =>
        Effect.suspend(() => {
          if (settled) return Effect.void;
          settled = true;
          return Clock.currentTimeMillis.pipe(
            Effect.flatMap((nowMs) =>
              Deferred.succeed(done, { exitCode, durationMs: nowMs - startedAtMs }),
            ),
            Effect.asVoid,
          );
        });

      const handleLine = (rawLine: string) =>
        Effect.suspend(() => {
          const sentinel = input.sentinelPattern.exec(rawLine);
          if (sentinel) {
            const parsed = Number(sentinel[1]);
            return settle(Number.isFinite(parsed) ? parsed : null);
          }
          const cleaned = stripTerminalControl(rawLine).trimEnd();
          if (
            cleaned.length === 0 ||
            cleaned.includes(input.sentinel) ||
            input.echoedWrapperLines.some((echoed) => cleaned.endsWith(echoed)) ||
            input.onOutputLine === undefined
          ) {
            return Effect.void;
          }
          return input.onOutputLine(cleaned.slice(0, OUTPUT_LINE_MAX_LENGTH));
        });

      const unsubscribe = yield* terminalManager.subscribe((event) => {
        if (event.threadId !== input.threadId || event.terminalId !== input.terminalId) {
          return Effect.void;
        }
        if (event.type === "output") {
          lineBuffer += event.data;
          // A bare carriage return is how installers redraw a progress line in
          // place; each redraw becomes a short line of its own instead of being
          // glued into one long one.
          const lines = lineBuffer.split(/\r\n|\r|\n/);
          lineBuffer = lines.pop() ?? "";
          // A script that never prints a newline must not grow this forever.
          // The sentinel is always on its own line, so keeping the tail is safe.
          if (lineBuffer.length > PARTIAL_LINE_MAX_LENGTH) {
            lineBuffer = lineBuffer.slice(-PARTIAL_LINE_MAX_LENGTH);
          }
          return Effect.forEach(lines, handleLine, { discard: true }).pipe(
            Effect.andThen(
              Effect.suspend(() =>
                settled && lineBuffer.length > 0
                  ? Deferred.succeed(promptReturned, undefined).pipe(Effect.asVoid)
                  : Effect.void,
              ),
            ),
          );
        }
        if (event.type === "exited" || event.type === "closed") {
          return settle(null).pipe(Effect.andThen(Deferred.succeed(promptReturned, undefined)));
        }
        return Effect.void;
      });

      const completion = Deferred.await(done).pipe(
        // A shell with an empty prompt never prints one; do not wait forever.
        Effect.tap(() => Deferred.await(promptReturned).pipe(Effect.timeoutOption("1 second"))),
        Effect.ensuring(Effect.sync(() => unsubscribe())),
      );
      return { completion, unsubscribe };
    },
  );

  const runForThread: ProjectSetupScriptRunner["Service"]["runForThread"] = Effect.fn(
    "ProjectSetupScriptRunner.runForThread",
  )(function* (input) {
    const errorContext = {
      threadId: input.threadId,
      worktreePath: input.worktreePath,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.projectCwd === undefined ? {} : { projectCwd: input.projectCwd }),
    };
    const suppliedProject = input.project;
    const projectById =
      suppliedProject ??
      (input.projectId
        ? yield* projects.getById(ProjectId.make(input.projectId)).pipe(
            Effect.map(Option.getOrUndefined),
            Effect.mapError(
              (cause) =>
                new ProjectSetupScriptOperationError({
                  ...errorContext,
                  operation: "resolveProject",
                  cause,
                }),
            ),
          )
        : null);
    const project =
      suppliedProject ??
      projectById ??
      (input.projectCwd
        ? yield* projects.getByWorkspaceRoot(input.projectCwd).pipe(
            Effect.map(Option.getOrUndefined),
            Effect.mapError(
              (cause) =>
                new ProjectSetupScriptOperationError({
                  ...errorContext,
                  operation: "resolveProject",
                  cause,
                }),
            ),
          )
        : null);

    if (!project) {
      return yield* new ProjectSetupScriptProjectNotFoundError(errorContext);
    }

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSetupScriptOperationError({
            ...errorContext,
            operation: "readSettings",
            cause,
          }),
      ),
    );
    const trigger = input.trigger ?? "setup";
    const scripts = resolveProjectScripts(settings, project);
    const script =
      trigger === "settle" ? settleProjectScript(scripts) : setupProjectScript(scripts);
    if (!script) {
      return {
        status: "no-script",
      } as const;
    }

    // A thread settles again after it is resumed, and an earlier settle shell
    // may still be busy; typing into it would feed its foreground program.
    const terminalId =
      input.preferredTerminalId ??
      (trigger === "settle"
        ? `settle-${script.id}-${(yield* crypto.randomUUIDv4().pipe(Effect.orDie)).slice(0, 8)}`
        : `setup-${script.id}`);
    const observe = input.observeCompletion;

    // An isolated run of a multi-repo workspace is a container with one
    // worktree per repository, and the script is written for a repository: it
    // runs once in each, told which checkout the worktree came from. A root
    // repository's worktree is the container itself, so it keeps the plain
    // terminal id, the one the setup card and existing links open.
    const isolatedRun = yield* workspaceRepositories.readIsolatedRun(input.worktreePath);
    const targets: ReadonlyArray<ScriptTarget> =
      isolatedRun === null || isolatedRun.repositories.length === 0
        ? [{ cwd: input.worktreePath, terminalId, name: null, repoRoot: null }]
        : isolatedRun.repositories
            .toSorted((left, right) =>
              left.relativePath === "." ? -1 : right.relativePath === "." ? 1 : 0,
            )
            .map((repository) => ({
              cwd: path.resolve(input.worktreePath, repository.relativePath),
              terminalId:
                repository.relativePath === "."
                  ? terminalId
                  : repositoryTerminalId(terminalId, repository.relativePath),
              name: repository.name,
              repoRoot: repository.source,
            }));

    const launch = Effect.fn("ProjectSetupScriptRunner.launch")(function* (target: ScriptTarget) {
      const env = {
        ...projectScriptRuntimeEnv({
          project: { cwd: project.workspaceRoot },
          worktreePath: target.cwd,
          ...(target.repoRoot === null ? {} : { extraEnv: { T3CODE_REPO_ROOT: target.repoRoot } }),
        }),
        // Setup can run before a client attaches. Truecolor probes in tools such
        // as Vite+ wait for terminal replies that nobody can send at that point.
        COLORTERM: "",
      };
      const completionToken = observe
        ? (yield* crypto.randomUUIDv4().pipe(Effect.orDie)).replaceAll("-", "")
        : null;
      const commandLine =
        observe && completionToken
          ? wrapCommandForCompletion(
              script.command,
              completionShell,
              completionSentinel(completionToken),
            )
          : script.command;
      // Several runs share one setup card, so each line says where it came from.
      const onOutputLine =
        observe?.onOutputLine === undefined
          ? undefined
          : target.name === null
            ? observe.onOutputLine
            : (line: string) => observe.onOutputLine!(`[${target.name}] ${line}`);

      yield* terminalManager
        .open({
          threadId: input.threadId,
          terminalId: target.terminalId,
          cwd: target.cwd,
          worktreePath: input.worktreePath,
          env: { ...env, NO_COLOR: "1", FORCE_COLOR: "0" },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProjectSetupScriptOperationError({
                ...errorContext,
                operation: "openTerminal",
                cause,
              }),
          ),
        );
      // Subscribe before writing so the sentinel cannot race past the listener.
      const observed =
        observe && completionToken
          ? yield* observeTerminalCompletion({
              threadId: input.threadId,
              terminalId: target.terminalId,
              sentinel: completionSentinel(completionToken),
              sentinelPattern: completionSentinelPattern(completionToken),
              echoedWrapperLines: commandLine.split("\r").filter((line) => line.length > 0),
              onOutputLine,
            })
          : undefined;

      yield* terminalManager
        .write({
          threadId: input.threadId,
          terminalId: target.terminalId,
          data: projectScriptTerminalInput(commandLine),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProjectSetupScriptOperationError({
                ...errorContext,
                operation: "writeCommand",
                cause,
              }),
          ),
          Effect.tapError(() => Effect.sync(() => observed?.unsubscribe())),
        );

      const completion = observed?.completion.pipe(
        Effect.tap(({ exitCode }) =>
          exitCode === 0
            ? terminalManager.closeIdle({
                threadId: input.threadId,
                terminalId: target.terminalId,
              })
            : Effect.void,
        ),
      );
      return { target, completion };
    });

    const launched = yield* Effect.forEach(targets, launch);
    const first = launched[0]!;
    const completions = launched.flatMap((run) => (run.completion ? [run] : []));
    const completion: Effect.Effect<ProjectSetupScriptCompletion> | undefined =
      completions.length === 0
        ? undefined
        : first.target.name === null
          ? first.completion
          : Effect.forEach(completions, (run) => run.completion!, {
              concurrency: "unbounded",
            }).pipe(
              Effect.map((results) => {
                const failing = results.find((result) => result.exitCode !== 0);
                return {
                  exitCode: failing === undefined ? 0 : failing.exitCode,
                  durationMs: Math.max(...results.map((result) => result.durationMs)),
                  repositories: results.map((result, index) => ({
                    name: completions[index]!.target.name!,
                    exitCode: result.exitCode,
                  })),
                };
              }),
            );

    return {
      status: "started",
      scriptId: script.id,
      scriptName: script.name,
      scriptCommand: script.command,
      terminalId: first.target.terminalId,
      cwd: first.target.cwd,
      async: script.async !== false,
      ...(completion ? { completion } : {}),
      ...(first.target.name === null
        ? {}
        : {
            repositories: launched.map((run) => ({
              name: run.target.name!,
              cwd: run.target.cwd,
              terminalId: run.target.terminalId,
            })),
          }),
    } as const;
  });

  return ProjectSetupScriptRunner.of({ runForThread });
});

export const layer = Layer.effect(ProjectSetupScriptRunner, make).pipe(
  Layer.provide(WorkspaceRepositories.layer),
);
