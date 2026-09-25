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

/** Shared runtime context; omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  /** True when the session spans more than one repository root. */
  readonly multiRepo?: boolean | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${model}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}${runtime.multiRepo ? `\n\n${MULTI_REPO_FILE_PATH_INSTRUCTIONS}` : ""}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
