import {
  filterRepositories,
  REPOSITORY_FILTER_THRESHOLD,
} from "@t3tools/client-runtime/repository-base-refs";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId, VcsRepository } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useState } from "react";
import { Alert, Platform, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { vcsEnvironment } from "../../../state/vcs";
import { RepositoryFilterField } from "../RepositoryFilterField";
import { SheetListRow, statusSummary } from "./gitSheetComponents";

/**
 * Picks which repository of a multi-repo workspace the Git sheet acts on. In an isolated run it
 * also adds a repository the run left out, giving it a worktree on the thread's branch, and
 * removes the picked one's worktree, keeping its branch. The run's own root cannot be removed.
 */
export function GitRepositoryPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly repositories: ReadonlyArray<VcsRepository>;
  /** Repositories the isolated run reaches as the project's checkouts. */
  readonly references: ReadonlyArray<VcsRepository>;
  /** The isolated run's folder; null for a thread on the project checkout. */
  readonly runCwd: string | null;
  readonly selectedRelativePath: string | null;
  readonly disabled: boolean;
  readonly onSelect: (relativePath: string) => void;
}) {
  const addRepository = useAtomCommand(vcsEnvironment.addRunRepository, { reportFailure: false });
  const removeRepository = useAtomCommand(vcsEnvironment.removeRunRepository, {
    reportFailure: false,
  });
  const [pending, setPending] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const showsFilter =
    props.repositories.length + props.references.length > REPOSITORY_FILTER_THRESHOLD;
  const shownRepositories = filterRepositories(props.repositories, query);
  const shownReferences = filterRepositories(props.references, query);
  const { runCwd } = props;
  const selected = props.repositories.find(
    (repository) => repository.relativePath === props.selectedRelativePath,
  );
  // Only offered for a repository the filter shows, so the row never names a hidden one.
  const removable =
    runCwd !== null &&
    selected !== undefined &&
    selected.relativePath !== "." &&
    props.repositories.length > 1 &&
    shownRepositories.includes(selected);

  const run = async (repository: VcsRepository, add: boolean) => {
    if (runCwd === null) return;
    setPending(repository.relativePath);
    const input = { cwd: runCwd, relativePath: repository.relativePath, threadId: props.threadId };
    const result = add
      ? await addRepository({ environmentId: props.environmentId, input })
      : await removeRepository({ environmentId: props.environmentId, input });
    setPending(null);
    if (result._tag !== "Failure") return;
    const error = squashAtomCommandFailure(result);
    Alert.alert(
      add ? `Could not add ${repository.name}` : `Could not remove ${repository.name}`,
      error !== null &&
        typeof error === "object" &&
        "detail" in error &&
        typeof error.detail === "string"
        ? error.detail
        : error instanceof Error
          ? error.message
          : "An error occurred.",
    );
  };
  const confirmRemove = (repository: VcsRepository) =>
    Alert.alert(
      `Remove ${repository.name} from this thread?`,
      "Its worktree is deleted; the branch and its commits stay. The thread goes back to reaching the project's own checkout.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void run(repository, false) },
      ],
    );

  return (
    <View className="gap-2">
      <Text className="px-1 text-xs font-t3-bold text-foreground-muted">Repository</Text>
      {showsFilter ? <RepositoryFilterField value={query} onChange={setQuery} /> : null}
      {shownRepositories.length > 0 ? (
        <View className="overflow-hidden bg-card android:rounded-[20px] ios:rounded-2xl ios:border ios:border-border ios:px-3 ios:py-1">
          {shownRepositories.map((repository, index) => (
            <View key={repository.path}>
              {index > 0 && Platform.OS !== "android" ? (
                <View className="ml-12 h-px bg-border" />
              ) : null}
              <GitRepositoryRow
                environmentId={props.environmentId}
                repository={repository}
                selected={repository.relativePath === props.selectedRelativePath}
                disabled={props.disabled}
                onSelect={props.onSelect}
              />
            </View>
          ))}
          {removable ? (
            <View>
              {Platform.OS !== "android" ? <View className="ml-12 h-px bg-border" /> : null}
              <SheetListRow
                icon="trash"
                title={
                  pending === selected.relativePath
                    ? `Removing ${selected.name}…`
                    : `Remove ${selected.name} from this thread`
                }
                subtitle="Deletes its worktree; the branch stays"
                accessory="none"
                disabled={props.disabled || pending !== null}
                onPress={() => confirmRemove(selected)}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      {runCwd !== null && shownReferences.length > 0 ? (
        <>
          <Text className="px-1 pt-2 text-xs font-t3-bold text-foreground-muted">
            Not in this thread
          </Text>
          <View className="overflow-hidden bg-card android:rounded-[20px] ios:rounded-2xl ios:border ios:border-border ios:px-3 ios:py-1">
            {shownReferences.map((repository, index) => (
              <View key={repository.relativePath}>
                {index > 0 && Platform.OS !== "android" ? (
                  <View className="ml-12 h-px bg-border" />
                ) : null}
                <SheetListRow
                  icon="plus"
                  title={repository.name}
                  subtitle={
                    pending === repository.relativePath
                      ? "Adding…"
                      : "Add a worktree on the thread's branch"
                  }
                  accessory="none"
                  disabled={props.disabled || pending !== null}
                  onPress={() => void run(repository, true)}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function GitRepositoryRow(props: {
  readonly environmentId: EnvironmentId;
  readonly repository: VcsRepository;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: (relativePath: string) => void;
}) {
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const { environmentId, repository } = props;
  // The server caches status; refresh it when the sheet opens, as web's Git menus do, so a
  // repository changed outside the app does not read as clean.
  const refreshOnOpen = useEffectEvent(() => {
    void refreshStatus({ environmentId, input: { cwd: repository.path } });
  });
  // Rows are keyed by path, so a row only ever refreshes its own repository.
  useEffect(() => {
    refreshOnOpen();
  }, []);
  const status = useEnvironmentQuery(
    vcsEnvironment.status({
      environmentId: props.environmentId,
      input: { cwd: props.repository.path },
    }),
  );
  const branch = status.data?.refName;
  const summary = statusSummary(status.data);
  return (
    <SheetListRow
      icon="folder"
      title={props.repository.name}
      subtitle={branch ? `${branch} · ${summary}` : summary}
      accessory={props.selected ? "checkmark" : "none"}
      disabled={props.disabled}
      onPress={() => props.onSelect(props.repository.relativePath)}
    />
  );
}
