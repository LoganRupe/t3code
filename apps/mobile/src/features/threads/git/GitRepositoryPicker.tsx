import type { EnvironmentId, VcsRepository } from "@t3tools/contracts";
import { useEffect, useEffectEvent } from "react";

import { ListChoiceRow } from "../../../components/ui/ListChoiceRow";
import { ListSection } from "../../../components/ui/ListSection";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import { vcsEnvironment } from "../../../state/vcs";
import { statusSummary } from "./gitSheetComponents";

/** Picks which repository of a multi-repo workspace the Git sheet acts on. */
export function GitRepositoryPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly repositories: ReadonlyArray<VcsRepository>;
  readonly selectedRelativePath: string | null;
  readonly disabled: boolean;
  readonly onSelect: (relativePath: string) => void;
}) {
  return (
    <ListSection title="Repository">
      {props.repositories.map((repository, index) => (
        <GitRepositoryRow
          key={repository.path}
          environmentId={props.environmentId}
          repository={repository}
          selected={repository.relativePath === props.selectedRelativePath}
          separated={index > 0}
          disabled={props.disabled}
          onSelect={props.onSelect}
        />
      ))}
    </ListSection>
  );
}

function GitRepositoryRow(props: {
  readonly environmentId: EnvironmentId;
  readonly repository: VcsRepository;
  readonly selected: boolean;
  readonly separated: boolean;
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
    <ListChoiceRow
      label={props.repository.name}
      description={branch ? `${branch} · ${summary}` : summary}
      selected={props.selected}
      separated={props.separated}
      disabled={props.disabled}
      onPress={() => props.onSelect(props.repository.relativePath)}
    />
  );
}
