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

/** A session that spans more than one repository root. */
export interface MultiRepoWorkspace {
  /** The session's working directory: the workspace folder, or one of the repo roots. */
  readonly cwd?: string | undefined;
  /** Every repository root of the project, in workspace order. */
  readonly repoRoots: ReadonlyArray<string>;
}

/** The multi-repo context for a session start, or undefined when it has a single root. */
export function multiRepoWorkspace(input: {
  readonly cwd?: string | undefined;
  readonly additionalRoots?: ReadonlyArray<string> | undefined;
  readonly repoRoots?: ReadonlyArray<string> | undefined;
}): MultiRepoWorkspace | undefined {
  if ((input.additionalRoots?.length ?? 0) === 0) return undefined;
  return { cwd: input.cwd, repoRoots: input.repoRoots ?? [] };
}

// Claude Code leaves repo roots inside its working directory out of the
// environment block it shows the model, and the other providers get no root
// list at all, so name the repos here.
function projectRepositoriesInstructions(workspace: MultiRepoWorkspace): string {
  if (workspace.repoRoots.length === 0) return "";
  const repos = workspace.repoRoots.map((root) => `- ${root}`).join("\n");
  const anchor =
    workspace.cwd && !workspace.repoRoots.includes(workspace.cwd)
      ? `\nThe working directory, ${workspace.cwd}, is the project's workspace folder, not a repository. Folders under it that are not listed above are not part of the project, so there is no need to search it for more repositories.`
      : "";
  return `\n\n<project_repositories>\nThis project's repositories are:\n${repos}${anchor}\n</project_repositories>`;
}

/** Shared runtime context; omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  /** Set when the session spans more than one repository root. */
  readonly multiRepo?: MultiRepoWorkspace | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${model}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const multiRepo = runtime.multiRepo
    ? `\n\n${MULTI_REPO_FILE_PATH_INSTRUCTIONS}${projectRepositoriesInstructions(runtime.multiRepo)}`
    : "";
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}${multiRepo}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
