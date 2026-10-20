import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  filterRepositories,
  REPOSITORY_FILTER_THRESHOLD,
  repositoryBaseRefChoices,
} from "@t3tools/client-runtime/repository-base-refs";
import type { EnvironmentId, ThreadId, VcsRepository } from "@t3tools/contracts";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { useRepositoryBaseRefStore, useWorktreeRepositories } from "../repositoryBaseRefStore";
import { usePaginatedBranches } from "../state/queries";
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
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";

/** The radio value that clears a pick; branch names are never empty. */
const DEFAULT_BRANCH = "";

/**
 * Repository picker for a multi-repo workspace's next isolated run: which repositories get a
 * worktree, and a base branch submenu for each that does. A base shows the repository's default
 * branch until the user picks one, which is what the server starts from without a pick. A
 * repository left out stays reachable as the project's checkout, and can be added to the thread
 * later. Carries the "start from origin" switch when no regular branch selector holds it.
 */
export const RepositoryBaseRefsMenu = memo(function RepositoryBaseRefsMenu({
  environmentId,
  threadId,
  repositories,
  startFromOrigin,
  onStartFromOriginChange,
  displayMode = "composer",
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  repositories: ReadonlyArray<VcsRepository>;
  startFromOrigin: boolean;
  onStartFromOriginChange?: (startFromOrigin: boolean) => void;
  displayMode?: "composer" | "panel";
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const threadKey = scopedThreadKey(scopeThreadRef(environmentId, threadId));
  const worktrees = useWorktreeRepositories(threadKey, repositories);
  const [query, setQuery] = useState("");
  const shown = filterRepositories(repositories, query);
  const setWorktree = useRepositoryBaseRefStore((store) => store.setWorktree);
  const withWorktree = repositories.filter((repository) =>
    worktrees.includes(repository.relativePath),
  );
  const pickCount = useRepositoryBaseRefStore(
    (store) =>
      withWorktree.filter((repository) => store.byThread[threadKey]?.[repository.relativePath])
        .length,
  );
  const repoCount = `${repositories.length} ${repositories.length === 1 ? "repo" : "repos"}`;
  const label = [
    withWorktree.length === repositories.length
      ? repoCount
      : `${withWorktree.length} of ${repoCount}`,
    ...(pickCount > 0 ? [`${pickCount} picked`] : []),
  ].join(", ");
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
        aria-label="Worktrees and base branches for each repository"
        data-composer-context-control
      >
        <GitBranchIcon className="size-3 shrink-0 opacity-70" />
        {label}
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup
        align={displayMode === "panel" ? "start" : "end"}
        side={displayMode === "panel" ? "bottom" : "top"}
        {...(displayMode === "panel" ? {} : composerFloatingLayerProps)}
      >
        {repositories.length > REPOSITORY_FILTER_THRESHOLD ? (
          <RepositoryFilterInput value={query} onChange={setQuery} />
        ) : null}
        <MenuGroup>
          <MenuGroupLabel>Give a worktree to</MenuGroupLabel>
          {shown.length === 0 ? <MenuItem disabled>No matching repositories</MenuItem> : null}
          {shown.map((repository) => (
            <MenuCheckboxItem
              key={repository.relativePath}
              checked={worktrees.includes(repository.relativePath)}
              onCheckedChange={(checked) =>
                setWorktree(threadKey, worktrees, repository.relativePath, checked)
              }
              closeOnClick={false}
            >
              <span className="min-w-0 truncate">{repository.name}</span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        {withWorktree.length > 0 ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Base branch</MenuGroupLabel>
              {withWorktree.map((repository) => (
                <RepositoryBaseRefSub
                  key={repository.relativePath}
                  environmentId={environmentId}
                  threadKey={threadKey}
                  repository={repository}
                  startFromOrigin={startFromOrigin}
                />
              ))}
            </MenuGroup>
          </>
        ) : null}
        {onStartFromOriginChange ? (
          <>
            <MenuSeparator />
            <MenuCheckboxItem
              variant="switch"
              checked={startFromOrigin}
              onCheckedChange={onStartFromOriginChange}
              closeOnClick={false}
            >
              Start from origin
            </MenuCheckboxItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});

function RepositoryBaseRefSub({
  environmentId,
  threadKey,
  repository,
  startFromOrigin,
}: {
  environmentId: EnvironmentId;
  threadKey: string;
  repository: VcsRepository;
  startFromOrigin: boolean;
}) {
  const pick = useRepositoryBaseRefStore(
    (store) => store.byThread[threadKey]?.[repository.relativePath] ?? null,
  );
  const setBaseRef = useRepositoryBaseRefStore((store) => store.setBaseRef);
  const refTarget = useMemo(
    () => ({ environmentId, cwd: repository.path, query: null }),
    [environmentId, repository.path],
  );
  const { refs } = usePaginatedBranches(refTarget);
  const { branchNames, defaultName } = useMemo(() => repositoryBaseRefChoices(refs), [refs]);
  const selected = pick ?? defaultName;
  const selectedLabel =
    selected && startFromOrigin && !selected.startsWith("origin/")
      ? `origin/${selected}`
      : selected;

  return (
    <MenuSub>
      <MenuSubTrigger>
        <span className="min-w-0 truncate">{repository.name}</span>
        <span className="ms-auto min-w-0 truncate ps-4 text-xs text-muted-foreground">
          {selectedLabel ?? "Loading…"}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <MenuRadioGroup
          value={pick ?? DEFAULT_BRANCH}
          onValueChange={(value) =>
            setBaseRef(
              threadKey,
              repository.relativePath,
              value === DEFAULT_BRANCH ? null : String(value),
            )
          }
        >
          <MenuRadioItem value={DEFAULT_BRANCH} closeOnClick>
            Default branch{defaultName ? ` (${defaultName})` : ""}
          </MenuRadioItem>
          {branchNames.map((name) => (
            <MenuRadioItem key={name} value={name} closeOnClick>
              {name}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuSubPopup>
    </MenuSub>
  );
}
