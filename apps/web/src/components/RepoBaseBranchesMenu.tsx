import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useRepoBaseBranchStore } from "../repoBaseBranchStore";
import { usePaginatedBranches } from "../state/queries";
import { ComposerControl } from "./chat/ComposerControl";
import { useComposerMenuProps } from "./chat/composerEventScope";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "./ui/menu";

function repoName(repoRoot: string): string {
  const trimmed = repoRoot.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

/**
 * Base-branch picker for the non-anchor roots of a multi-repo project's next
 * isolated run. The anchor keeps the regular "From <branch>" selector; each
 * other root shows its own default branch (origin/HEAD) until the user picks
 * one, matching what the server falls back to.
 */
export const RepoBaseBranchesMenu = memo(function RepoBaseBranchesMenu({
  environmentId,
  threadId,
  repoRoots,
  startFromOrigin,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  repoRoots: ReadonlyArray<string>;
  startFromOrigin: boolean;
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const threadKey = scopedThreadKey(scopeThreadRef(environmentId, threadId));
  return (
    <Menu>
      <MenuTrigger
        render={<ComposerControl size="xs" />}
        aria-label="Base branches for the other repos"
        data-composer-context-control
      >
        <GitBranchIcon className="size-3 shrink-0 opacity-70" />+{repoRoots.length}{" "}
        {repoRoots.length === 1 ? "repo" : "repos"}
        <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
      </MenuTrigger>
      <MenuPopup align="end" side="top" {...composerFloatingLayerProps}>
        <MenuGroup>
          <MenuGroupLabel>Base for the other repos</MenuGroupLabel>
          {repoRoots.map((repoRoot) => (
            <RepoBaseBranchSub
              key={repoRoot}
              environmentId={environmentId}
              threadKey={threadKey}
              repoRoot={repoRoot}
              startFromOrigin={startFromOrigin}
            />
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});

function RepoBaseBranchSub({
  environmentId,
  threadKey,
  repoRoot,
  startFromOrigin,
}: {
  environmentId: EnvironmentId;
  threadKey: string;
  repoRoot: string;
  startFromOrigin: boolean;
}) {
  const pick = useRepoBaseBranchStore((store) => store.byThread[threadKey]?.[repoRoot] ?? null);
  const setBase = useRepoBaseBranchStore((store) => store.setBase);
  const refTarget = useMemo(
    () => ({ environmentId, cwd: repoRoot, query: null }),
    [environmentId, repoRoot],
  );
  const { refs } = usePaginatedBranches(refTarget);
  // Local branches, plus the default branch's origin copy when it has no local
  // one, so the default the server would use is always pickable.
  const branchNames = useMemo(() => {
    const local = refs.filter((ref) => !ref.isRemote).map((ref) => ref.name);
    const remoteDefault = refs.find((ref) => ref.isRemote && ref.isDefault);
    return remoteDefault && !refs.some((ref) => !ref.isRemote && ref.isDefault)
      ? [remoteDefault.name, ...local]
      : local;
  }, [refs]);
  const defaultName =
    refs.find((ref) => ref.isDefault && !ref.isRemote)?.name ??
    refs.find((ref) => ref.isDefault)?.name ??
    refs.find((ref) => ref.current)?.name ??
    null;
  const selected = pick ?? defaultName;
  const selectedLabel =
    selected && startFromOrigin && !selected.startsWith("origin/")
      ? `origin/${selected}`
      : selected;

  return (
    <MenuSub>
      <MenuSubTrigger>
        <span className="min-w-0 truncate">{repoName(repoRoot)}</span>
        <span className="ms-auto min-w-0 truncate ps-4 text-muted-foreground text-xs">
          {selectedLabel ?? "Loading…"}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup>
        <MenuRadioGroup
          value={selected ?? ""}
          onValueChange={(value) => setBase(threadKey, repoRoot, String(value))}
        >
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
