import type {
  EnvironmentId,
  FilesystemReadWorkspaceFileResult,
  ProjectId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useEffect } from "react";

import { toastManager } from "../components/ui/toast";
import { filesystemEnvironment } from "../state/filesystem";
import { projectEnvironment } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";

/**
 * Tracks which `.code-workspace`-backed projects have already been reconciled
 * this session, so the on-load re-read fires once per project rather than on
 * every re-render. Keyed by scoped project ref.
 */
const reconciledWorkspaceProjectKeys = new Set<string>();

function arraysEqualUnordered(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

type ReadWorkspaceFileRunner = (target: {
  environmentId: EnvironmentId;
  input: { workspaceFilePath: string };
}) => Promise<AtomCommandResult<FilesystemReadWorkspaceFileResult, unknown>>;

type UpdateProjectRunner = (value: {
  environmentId: EnvironmentId;
  input: { projectId: ProjectId; workspaceFile: string; repoRoots: readonly string[] };
}) => Promise<AtomCommandResult<unknown, unknown>>;

/**
 * Re-read a project's `.code-workspace` from disk (Q4 = re-read on load, no
 * live watching) and reconcile its persisted `repoRoots`/identity with the
 * file. Surfaces missing/renamed folders rather than crashing. A no-op when the
 * resolved roots already match, so it never loops against the resulting
 * `project.meta-updated` event.
 */
async function reconcileWorkspaceProject(
  project: EnvironmentProject,
  readWorkspaceFile: ReadWorkspaceFileRunner,
  updateProject: UpdateProjectRunner,
): Promise<void> {
  if (!project.workspaceFile) {
    return;
  }
  const scopedKey = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
  if (reconciledWorkspaceProjectKeys.has(scopedKey)) {
    return;
  }
  reconciledWorkspaceProjectKeys.add(scopedKey);

  const readResult = await readWorkspaceFile({
    environmentId: project.environmentId,
    input: { workspaceFilePath: project.workspaceFile },
  });
  if (readResult._tag === "Failure") {
    reconciledWorkspaceProjectKeys.delete(scopedKey);
    if (!isAtomCommandInterrupted(readResult)) {
      const error = squashAtomCommandFailure(readResult);
      toastManager.add({
        type: "warning",
        title: `Workspace file unavailable for "${project.title}"`,
        description:
          error instanceof Error ? error.message : "The .code-workspace could not be read.",
      });
    }
    return;
  }
  const resolved = readResult.value;

  const missing = resolved.folders.filter((folder) => !folder.exists);
  if (missing.length > 0) {
    toastManager.add({
      type: "warning",
      title: `Missing folders in "${project.title}"`,
      description: `${missing.map((folder) => folder.name).join(", ")} could not be found on disk.`,
    });
  }

  // `repoRoots` is optional on a project; an absent value means the workspace
  // root is the only repo root (see types.ts notes on multi-repo workspaces).
  const projectRepoRoots = project.repoRoots ?? [project.workspaceRoot];
  if (
    arraysEqualUnordered(resolved.repoRoots, projectRepoRoots) &&
    resolved.workspaceFilePath === project.workspaceFile
  ) {
    return;
  }

  const updateResult = await updateProject({
    environmentId: project.environmentId,
    input: {
      projectId: project.id,
      workspaceFile: resolved.workspaceFilePath,
      repoRoots: resolved.repoRoots,
    },
  });
  if (updateResult._tag === "Failure" && !isAtomCommandInterrupted(updateResult)) {
    const error = squashAtomCommandFailure(updateResult);
    console.error("Failed to reconcile workspace folders", {
      projectId: project.id,
      environmentId: project.environmentId,
      error,
    });
  }
}

/**
 * Reconcile every `.code-workspace`-backed project against its file once per
 * session. Mounted above the sidebar so it runs whichever sidebar is active.
 */
export function useWorkspaceProjectReconcile(projects: ReadonlyArray<EnvironmentProject>): void {
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const readWorkspaceFile = useAtomQueryRunner(filesystemEnvironment.readWorkspaceFile, {
    reportFailure: false,
  });

  useEffect(() => {
    for (const project of projects) {
      if (project.workspaceFile) {
        void reconcileWorkspaceProject(project, readWorkspaceFile, updateProject);
      }
    }
  }, [projects, readWorkspaceFile, updateProject]);
}
