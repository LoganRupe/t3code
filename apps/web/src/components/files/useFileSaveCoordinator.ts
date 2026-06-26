import type { EnvironmentId } from "@t3tools/contracts";
import { createRef, useEffect, useMemo } from "react";

import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import { FileSaveCoordinator } from "./fileSaveCoordinator";
import { confirmProjectFileQueryData } from "./projectFilesQueryState";

const FILE_SAVE_DEBOUNCE_MS = 500;

interface FileSaveOptions {
  environmentId: EnvironmentId;
  cwd: string;
  relativePath: string;
  // Multi-repo workspaces (#923): the repo root that owns this file, forwarded
  // to `onPendingChange` so the pending state lands on the surface that opened
  // it in a non-anchor repo. Absent for single-repo projects.
  root?: string | undefined;
  onPendingChange: (relativePath: string, pending: boolean, root?: string | undefined) => void;
}

export function useFileSaveCoordinator({
  environmentId,
  cwd,
  relativePath,
  root,
  onPendingChange,
}: FileSaveOptions): Pick<FileSaveCoordinator, "change"> {
  const writeFile = useAtomCommand(projectEnvironment.writeFile);
  const session = useMemo(() => {
    const coordinatorRef = createRef<FileSaveCoordinator>();
    return {
      change: (contents: string) => coordinatorRef.current?.change(contents),
      setup: () => {
        const coordinator = new FileSaveCoordinator({
          debounceMs: FILE_SAVE_DEBOUNCE_MS,
          onPendingChange: (pending) => onPendingChange(relativePath, pending, root),
          persist: (nextContents) =>
            writeFile({
              environmentId,
              input: { cwd, relativePath, contents: nextContents },
            }),
          onConfirmed: (confirmedContents) => {
            confirmProjectFileQueryData(environmentId, cwd, relativePath, confirmedContents);
          },
        });
        coordinatorRef.current = coordinator;
        return () => {
          coordinatorRef.current = null;
          coordinator.dispose();
        };
      },
    };
  }, [cwd, environmentId, onPendingChange, relativePath, root, writeFile]);

  // StrictMode replays effect setup. Retired file sessions stay inert, while the
  // replay gets a fresh coordinator instead of reusing a disposed one.
  useEffect(session.setup, [session]);
  return session;
}
