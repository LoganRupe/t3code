/**
 * WorkspaceGitScan - Effect service contract for discovering sibling git
 * repositories beneath a parent directory.
 *
 * Used by the add-project flow so users can pick a parent folder and attach
 * multiple sibling git repos to a single multi-root project.
 *
 * @module WorkspaceGitScan
 */
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";
import type * as Effect from "effect/Effect";

import type { FilesystemScanGitReposInput, FilesystemScanGitReposResult } from "@t3tools/contracts";

export class WorkspaceGitScanError extends Schema.TaggedErrorClass<WorkspaceGitScanError>()(
  "WorkspaceGitScanError",
  {
    parentPath: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface WorkspaceGitScanShape {
  readonly scan: (
    input: FilesystemScanGitReposInput,
  ) => Effect.Effect<FilesystemScanGitReposResult, WorkspaceGitScanError>;
}

export class WorkspaceGitScan extends Context.Service<WorkspaceGitScan, WorkspaceGitScanShape>()(
  "t3/workspace/Services/WorkspaceGitScan",
) {}
