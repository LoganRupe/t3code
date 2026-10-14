import type { EnvironmentId, VcsRepository } from "@t3tools/contracts";
import { useEffect, useEffectEvent } from "react";
import { Platform, View } from "react-native";

import { AppText as Text } from "../../../components/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { vcsEnvironment } from "../../../state/vcs";
import { SheetListRow, statusSummary } from "./gitSheetComponents";

/** Picks which repository of a multi-repo workspace the Git sheet acts on. */
export function GitRepositoryPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly repositories: ReadonlyArray<VcsRepository>;
  readonly selectedRelativePath: string | null;
  readonly disabled: boolean;
  readonly onSelect: (relativePath: string) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="px-1 text-xs font-t3-bold text-foreground-muted">Repository</Text>
      <View className="overflow-hidden bg-card android:rounded-[20px] ios:rounded-2xl ios:border ios:border-border ios:px-3 ios:py-1">
        {props.repositories.map((repository, index) => (
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
      </View>
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
