import {
  filterRepositories,
  REPOSITORY_FILTER_THRESHOLD,
} from "@t3tools/client-runtime/repository-base-refs";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId, VcsRepository } from "@t3tools/contracts";
import { ChevronDownIcon, FolderGit2Icon } from "lucide-react";
import { memo, useState } from "react";

import { useRunRepositories } from "../hooks/useWorkspaceRepositories";
import { readLocalApi } from "../localApi";
import { vcsEnvironment } from "../state/vcs";
import { useAtomCommand } from "../state/use-atom-command";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { RepositoryFilterInput } from "./RepositoryFilterInput";
import { Button } from "./ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "./ui/menu";
import { stackedThreadToast, toastManager } from "./ui/toast";

/**
 * The repositories of a multi-repo thread's isolated run. A checked one has a worktree on the
 * thread's branch; an unchecked one is reached as the project's own checkout. Checking adds a
 * worktree and runs the setup script in it; unchecking removes the worktree and keeps its
 * branch. The run's own root repository cannot be removed. Renders nothing for any other folder.
 */
export const RunRepositoriesMenu = memo(function RunRepositoriesMenu({
  environmentId,
  threadId,
  cwd,
  displayMode = "composer",
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  cwd: string;
  displayMode?: "composer" | "panel";
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const { repositories, references } = useRunRepositories({ environmentId, cwd });
  const addRepository = useAtomCommand(vcsEnvironment.addRunRepository, { reportFailure: false });
  const removeRepository = useAtomCommand(vcsEnvironment.removeRunRepository, {
    reportFailure: false,
  });
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  if (repositories.length + references.length < 2) return null;

  const all = [...repositories, ...references].toSorted((left, right) =>
    left.relativePath === "." ? -1 : right.relativePath === "." ? 1 : 0,
  );
  const shown = filterRepositories(all, query);
  const hasWorktree = (repository: VcsRepository) =>
    repositories.some((candidate) => candidate.relativePath === repository.relativePath);

  const toggle = async (repository: VcsRepository, add: boolean) => {
    if (!add) {
      const message = `Remove ${repository.name} from this thread?\n\nIts worktree is deleted; the branch and its commits stay. The thread goes back to reaching the project's own checkout.`;
      const api = readLocalApi();
      const confirmed = api
        ? await api.dialogs.confirm(message, { variant: "destructive" })
        : window.confirm(message);
      if (!confirmed) return;
    }
    setPending(repository.relativePath);
    const input = { cwd, relativePath: repository.relativePath, threadId };
    const result = add
      ? await addRepository({ environmentId, input })
      : await removeRepository({ environmentId, input });
    setPending(null);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: add ? `Could not add ${repository.name}` : `Could not remove ${repository.name}`,
          description:
            error &&
            typeof error === "object" &&
            "detail" in error &&
            typeof error.detail === "string"
              ? error.detail
              : error instanceof Error
                ? error.message
                : "An error occurred.",
        }),
      );
    }
  };

  const label = `${repositories.length} of ${all.length} repos`;
  return (
    <Menu onOpenChange={(open) => !open && setQuery("")}>
      <MenuTrigger
        render={
          displayMode === "panel" ? (
            <Button variant="outline" size="sm" className="w-full justify-between" />
          ) : (
            <Button variant="ghost-muted" size="xs" />
          )
        }
        aria-label="Repositories in this thread"
        data-composer-context-control
      >
        <FolderGit2Icon className="size-3 shrink-0 opacity-70" />
        {label}
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup
        align={displayMode === "panel" ? "start" : "end"}
        side={displayMode === "panel" ? "bottom" : "top"}
        {...(displayMode === "panel" ? {} : composerFloatingLayerProps)}
      >
        {all.length > REPOSITORY_FILTER_THRESHOLD ? (
          <RepositoryFilterInput value={query} onChange={setQuery} />
        ) : null}
        <MenuGroup>
          <MenuGroupLabel>Worktrees in this thread</MenuGroupLabel>
          {shown.length === 0 ? <MenuItem disabled>No matching repositories</MenuItem> : null}
          {shown.map((repository) => (
            <MenuCheckboxItem
              key={repository.relativePath}
              checked={hasWorktree(repository)}
              disabled={repository.relativePath === "." || pending !== null}
              onCheckedChange={(checked) => void toggle(repository, checked)}
              closeOnClick={false}
            >
              <span className="min-w-0 truncate">{repository.name}</span>
              {pending === repository.relativePath ? (
                <span className="ms-auto ps-4 text-xs text-muted-foreground">
                  {hasWorktree(repository) ? "Removing…" : "Adding…"}
                </span>
              ) : null}
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});
