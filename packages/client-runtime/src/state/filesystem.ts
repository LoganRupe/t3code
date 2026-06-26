import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export function createFilesystemEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    browse: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:filesystem:browse",
      tag: WS_METHODS.filesystemBrowse,
    }),
    scanGitRepos: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:filesystem:scanGitRepos",
      tag: WS_METHODS.filesystemScanGitRepos,
    }),
    readWorkspaceFile: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:filesystem:readWorkspaceFile",
      tag: WS_METHODS.filesystemReadWorkspaceFile,
    }),
    writeWorkspaceFile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:filesystem:writeWorkspaceFile",
      tag: WS_METHODS.filesystemWriteWorkspaceFile,
    }),
  };
}
