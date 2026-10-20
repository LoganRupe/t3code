import { sanitizeNewRefName } from "@t3tools/shared/git";
import { parseChangeRequestUrl } from "@t3tools/shared/changeRequestUrl";
import { resolveSendEnvMode } from "@t3tools/shared/projectSettings";
import type { ComposerDraftWorkspaceSelection } from "../../state/use-composer-drafts";

type WorkspaceMode = "local" | "worktree";

export function resolveNewTaskWorkspaceSelection(input: {
  readonly selection: ComposerDraftWorkspaceSelection | undefined;
  readonly fallback: ComposerDraftWorkspaceSelection;
  readonly isGitRepo: boolean;
}): ComposerDraftWorkspaceSelection {
  const selection = input.selection ?? input.fallback;
  const mode = resolveSendEnvMode({ requestedEnvMode: selection.mode, isGitRepo: input.isGitRepo });
  return input.isGitRepo ? selection : { mode, branch: null, worktreePath: null };
}

export function resolveNewTaskWorkspaceLabel(input: {
  readonly workspaceMode: WorkspaceMode;
  readonly worktreePath: string | null;
}): "Current checkout" | "Current worktree" | "New worktree" {
  if (input.workspaceMode === "worktree") {
    return "New worktree";
  }
  return input.worktreePath ? "Current worktree" : "Current checkout";
}

export function resolveNewTaskBranchWorktreePath(input: {
  readonly workspaceMode: WorkspaceMode;
  readonly projectCwd: string;
  readonly branchWorktreePath: string | null | undefined;
}): string | null {
  if (
    input.workspaceMode === "worktree" ||
    !input.branchWorktreePath ||
    input.branchWorktreePath === input.projectCwd
  ) {
    return null;
  }
  return input.branchWorktreePath;
}

export function resolveNewTaskLocalWorkspaceSelection(input: {
  readonly branches: ReadonlyArray<{
    readonly name: string;
    readonly current: boolean;
    readonly worktreePath?: string | null;
  }>;
  readonly projectCwd: string;
}): {
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly awaitsCurrentBranch: boolean;
} {
  const currentBranch = input.branches.find((branch) => branch.current) ?? null;
  if (!currentBranch) {
    return {
      branch: null,
      worktreePath: null,
      awaitsCurrentBranch: true,
    };
  }

  return {
    branch: currentBranch.name,
    worktreePath: resolveNewTaskBranchWorktreePath({
      workspaceMode: "local",
      projectCwd: input.projectCwd,
      branchWorktreePath: currentBranch.worktreePath,
    }),
    awaitsCurrentBranch: false,
  };
}

export function resolveNewTaskBranchLabel(input: {
  readonly branchName: string | null;
  readonly startFromOrigin: boolean;
  readonly workspaceMode: WorkspaceMode;
  readonly pullRequestReference?: string;
}): string {
  if (input.workspaceMode === "worktree" && input.pullRequestReference) {
    const pr = parseChangeRequestUrl(input.pullRequestReference);
    if (pr) return `From PR #${pr.number}`;
  }
  if (!input.branchName) {
    return "Choose branch";
  }

  if (input.workspaceMode === "local") {
    return input.branchName;
  }

  // Only the server can determine a local branch's configured remote.
  return input.startFromOrigin ? `From ${input.branchName} (remote)` : `From ${input.branchName}`;
}

/**
 * The control naming a multi-repo workspace's repositories, how many get a worktree, and how
 * many of those have their own base.
 */
export function resolveRepositoryBaseRefsLabel(input: {
  readonly repositoryCount: number;
  readonly worktreeCount: number;
  readonly pickCount: number;
}): string {
  const repositories = `${input.repositoryCount} ${input.repositoryCount === 1 ? "repo" : "repos"}`;
  const count =
    input.worktreeCount === input.repositoryCount
      ? repositories
      : `${input.worktreeCount} of ${repositories}`;
  return input.pickCount > 0 ? `${count}, ${input.pickCount} picked` : count;
}

export function shouldCheckoutNewTaskBranch(input: {
  readonly branchIsCurrent: boolean;
  readonly branchWorktreePath: string | null | undefined;
  readonly workspaceMode: WorkspaceMode;
}): boolean {
  return input.workspaceMode === "local" && !input.branchIsCurrent && !input.branchWorktreePath;
}

export function filterNewTaskBranches<T extends { readonly name: string }>(
  branches: ReadonlyArray<T>,
  rawQuery: string,
): ReadonlyArray<T> {
  const query = sanitizeNewRefName(rawQuery).toLowerCase();
  return query.length === 0
    ? branches
    : branches.filter((branch) => branch.name.toLowerCase().includes(query));
}
