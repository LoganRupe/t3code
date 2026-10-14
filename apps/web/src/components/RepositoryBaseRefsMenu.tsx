import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { repositoryBaseRefChoices } from "@t3tools/client-runtime/repository-base-refs";
import type { EnvironmentId, ThreadId, VcsRepository } from "@t3tools/contracts";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useRepositoryBaseRefStore } from "../repositoryBaseRefStore";
import { usePaginatedBranches } from "../state/queries";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { Button } from "./ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
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
 * Base branch picker for the repositories of a multi-repo workspace in a thread's next isolated
 * run, one submenu per repository. Each shows its own default branch until the user picks one,
 * which is what the server starts from without a pick. Carries the "start from origin" switch
 * when no regular branch selector is there to hold it.
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
  const pickCount = useRepositoryBaseRefStore(
    (store) =>
      repositories.filter((repository) => store.byThread[threadKey]?.[repository.relativePath])
        .length,
  );
  const label =
    pickCount > 0
      ? `${repositories.length} ${repositories.length === 1 ? "repo" : "repos"}, ${pickCount} picked`
      : `${repositories.length} ${repositories.length === 1 ? "repo" : "repos"}`;
  return (
    <Menu>
      <MenuTrigger
        render={
          displayMode === "panel" ? (
            <Button variant="outline" size="sm" className="w-full justify-between" />
          ) : (
            <Button variant="ghost-muted" size="xs" />
          )
        }
        aria-label="Base branches for each repository"
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
        <MenuGroup>
          <MenuGroupLabel>Base branch for each repository</MenuGroupLabel>
          {repositories.map((repository) => (
            <RepositoryBaseRefSub
              key={repository.relativePath}
              environmentId={environmentId}
              threadKey={threadKey}
              repository={repository}
              startFromOrigin={startFromOrigin}
            />
          ))}
        </MenuGroup>
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
