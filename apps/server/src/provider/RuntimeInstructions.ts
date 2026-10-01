const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the t3-code MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked.
</pull_request_linking>`;

const MULTI_REPO_FILE_PATH_INSTRUCTIONS = `<multi_repo_workspace>
This workspace contains more than one git repository, and the same relative path, such as src/index.ts, can exist in several of them. The user's client turns a path written in inline code, such as \`/abs/path/file.ts\`, into a link that opens the file. It opens a relative path against the workspace root, so that link opens the wrong file or none. Write every file and directory path in inline code as a full absolute path that starts with "/" (or a drive letter on Windows), each time you mention it, in prose, tables, lists, and summaries alike. Code blocks and text meant to be pasted elsewhere keep their usual paths.

Tools print relative paths: git status and grep print them relative to the directory they ran in, and git diff, git show, git log, and git stash show print them relative to the repository root. Put that directory's absolute path in front of each one.

<example>
git -C <repository root> stash show lists dir/file.py. Write \`<repository root>/dir/file.py\`, with the real absolute path of that repository in place of <repository root>.
</example>

Replies in this workspace have slipped in these ways. Before you send a response, check it for each one:
- a path written in full once, then shortened on a later mention or in the closing summary
- a list of files copied from git output, such as the files in a stash, commit, or diff
- a submodule path, or a repository written as \`~/name\`
- a bare file name, such as \`README.md\`, that stands for a specific file
</multi_repo_workspace>`;

/**
 * A session with folders beyond its working directory: a multi-repo workspace,
 * a project with plain folders, or both.
 */
export interface MultiRepoWorkspace {
  /** The session's working directory: the workspace folder, or one of the repo roots. */
  readonly cwd?: string | undefined;
  /** Every repository root the session works in (the worktrees, in an isolated run). */
  readonly repoRoots: ReadonlyArray<string>;
  /** Project folders that are not git repositories. */
  readonly plainFolders?: ReadonlyArray<string> | undefined;
  /** Set when the session runs in worktrees, which leaves the plain folders as shared originals. */
  readonly isolatedRun?: boolean | undefined;
  /** Set when plain folders are all the session has beyond its working directory, so the multi-repo path rules do not apply. */
  readonly singleRepo?: boolean | undefined;
}

/**
 * The workspace context for a session start, or undefined when it has neither
 * repo roots beyond its working directory nor plain folders.
 */
export function multiRepoWorkspace(input: {
  readonly cwd?: string | undefined;
  readonly additionalRoots?: ReadonlyArray<string> | undefined;
  readonly repoRoots?: ReadonlyArray<string> | undefined;
  readonly plainFolders?: ReadonlyArray<string> | undefined;
  readonly isolatedRun?: boolean | undefined;
}): MultiRepoWorkspace | undefined {
  const plainFolders = input.plainFolders ?? [];
  // `additionalRoots` also carries the plain folders outside `cwd`.
  const spansRepos = (input.additionalRoots ?? []).some((root) => !plainFolders.includes(root));
  if (!spansRepos && plainFolders.length === 0) return undefined;
  return {
    cwd: input.cwd,
    repoRoots: input.repoRoots ?? [],
    ...(plainFolders.length > 0 ? { plainFolders } : {}),
    ...(plainFolders.length > 0 && input.isolatedRun ? { isolatedRun: true } : {}),
    ...(spansRepos ? {} : { singleRepo: true }),
  };
}

// Claude Code leaves repo roots inside its working directory out of the
// environment block it shows the model, and the other providers show the model
// no root list at all, so name the repos here.
function projectRepositoriesInstructions(workspace: MultiRepoWorkspace): string {
  if (workspace.repoRoots.length === 0) return "";
  const repos = workspace.repoRoots.map((root) => `- ${root}`).join("\n");
  const anchor =
    workspace.cwd && !workspace.repoRoots.includes(workspace.cwd)
      ? `\nThe working directory, ${workspace.cwd}, is the project's workspace folder, not a repository. Other repositories under it are not part of this project, so there is no need to search it for more.`
      : "";
  return `\n\n<project_repositories>\nThis project's repositories are:\n${repos}${anchor}\n</project_repositories>`;
}

// Plain folders get their own list: they are part of the project, but git,
// worktrees and checkpoints do not cover them.
function projectFoldersInstructions(workspace: MultiRepoWorkspace): string {
  const plainFolders = workspace.plainFolders ?? [];
  if (plainFolders.length === 0) return "";
  const folders = plainFolders.map((folder) => `- ${folder}`).join("\n");
  const originals = workspace.isolatedRun
    ? "\nThese are the original folders, shared with other runs of this project, and T3 Code checkpoints do not cover changes made in them."
    : "";
  return `\n\n<project_folders>\nThese folders are also part of this project. They are not git repositories:\n${folders}${originals}\n</project_folders>`;
}

/**
 * Shared runtime context; omit model and effort when the harness manages them dynamically.
 * `modelName` is the display name users see in the model picker; `model` is the slug.
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly modelName?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  /** Set when the session has repo roots beyond its working directory, or plain folders. */
  readonly multiRepo?: MultiRepoWorkspace | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const modelName = toSingleLine(runtime.modelName ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelLabel =
    modelName && modelName !== model ? `${modelName} (model slug: ${model})` : model;
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${modelLabel}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const repositories =
    runtime.multiRepo && !runtime.multiRepo.singleRepo
      ? `\n\n${MULTI_REPO_FILE_PATH_INSTRUCTIONS}${projectRepositoriesInstructions(runtime.multiRepo)}`
      : "";
  const multiRepo = runtime.multiRepo
    ? `${repositories}${projectFoldersInstructions(runtime.multiRepo)}`
    : "";
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}${multiRepo}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
