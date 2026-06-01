import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const FILESYSTEM_PATH_MAX_LENGTH = 512;

export const FilesystemBrowseInput = Schema.Struct({
  partialPath: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  cwd: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH))),
});
export type FilesystemBrowseInput = typeof FilesystemBrowseInput.Type;

export const FilesystemBrowseEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  fullPath: TrimmedNonEmptyString,
});
export type FilesystemBrowseEntry = typeof FilesystemBrowseEntry.Type;

export const FilesystemBrowseResult = Schema.Struct({
  parentPath: TrimmedNonEmptyString,
  entries: Schema.Array(FilesystemBrowseEntry),
});
export type FilesystemBrowseResult = typeof FilesystemBrowseResult.Type;

export class FilesystemBrowseError extends Schema.TaggedErrorClass<FilesystemBrowseError>()(
  "FilesystemBrowseError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export const FilesystemScanGitReposInput = Schema.Struct({
  parentPath: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
});
export type FilesystemScanGitReposInput = typeof FilesystemScanGitReposInput.Type;

export const FilesystemScanGitReposChild = Schema.Struct({
  name: TrimmedNonEmptyString,
  absolutePath: TrimmedNonEmptyString,
  hasGit: Schema.Boolean,
});
export type FilesystemScanGitReposChild = typeof FilesystemScanGitReposChild.Type;

export const FilesystemScanGitReposResult = Schema.Struct({
  parentPath: TrimmedNonEmptyString,
  parentHasGit: Schema.Boolean,
  children: Schema.Array(FilesystemScanGitReposChild),
});
export type FilesystemScanGitReposResult = typeof FilesystemScanGitReposResult.Type;

export class FilesystemScanGitReposError extends Schema.TaggedErrorClass<FilesystemScanGitReposError>()(
  "FilesystemScanGitReposError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
