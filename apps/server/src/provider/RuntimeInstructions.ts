const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the t3-code MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked.
</pull_request_linking>`;

const MULTI_REPO_FILE_PATH_INSTRUCTIONS = `<multi_repo_workspace>
MANDATORY RULE: In this workspace, every file or directory path that you write in a response MUST be a full absolute path. There are no exceptions.

Why: this workspace contains more than one git repository. The same relative path, for example .graft/config.json, can exist in several of these repositories. A relative path, a shortened path, or a bare file name does not identify one file. The user's client opens it against the workspace root, so it opens the wrong file or no file.

The rule applies:
- to every mention of a path, in every part of the response: prose, inline code, links, lists, tables, headings, recommendations, and summaries.
- to each mention separately. If you wrote the absolute path of a file earlier in the same response, write the full absolute path again. You are not permitted to shorten it.
- to paths that you copy from tool output. git status, git diff, grep, rg, ls, and find print relative paths. Convert each path to an absolute path before you write it.

Do NOT write:
- a relative path, for example \`.graft/config.json\` or \`src/index.ts\`.
- a path that starts with "./" or "../".
- a bare file or directory name that stands for a specific file or directory, for example \`config.json\` or \`.graft\`.
- "~" or an environment variable in place of the start of a path.

Build each absolute path from this template:
<base directory>/<relative path>
- <relative path> is the path as the tool printed it.
- <base directory> is the absolute path of the directory that the relative path starts from. For git diff and git show, it is the root of the repository that the command ran in. For git status, grep, rg, ls, and find, it is the directory that the command ran in: its working directory, or the directory given to cd or git -C.
- Example: the command git -C <repository root> status prints .graft/config.json. Write \`<repository root>/.graft/config.json\`, with the real absolute path of that repository in place of <repository root>.
- If you do not know which repository or directory a path belongs to, find out with a tool before you write the path. For example, run git rev-parse --show-toplevel in that directory. Do not guess.

MANDATORY CHECK before you send each response: find every file and directory path in the response. If a path does not start with "/" (or a drive letter on Windows), replace it with the full absolute path. Do this check again for paths in the last part of the response, because shortened paths occur most often there.
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
