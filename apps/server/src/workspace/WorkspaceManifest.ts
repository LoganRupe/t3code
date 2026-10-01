/**
 * WorkspaceManifest - resolve a project's roots into a launch-ready manifest.
 *
 * A multi-repo project spans several git repositories ("cousins") defined by a
 * `.code-workspace` file. The agent is handed the full root set rather than a
 * single cwd (decision D1: per-root agent context). This module turns the
 * persisted project shape (`workspaceRoot` anchor + `repoRoots`) — or, in
 * isolated mode, the per-thread worktree — into a stable manifest:
 *
 *   - `anchor` is the directory the provider session runs in (cwd). For a
 *     workspace-file project this is the `.code-workspace` file's directory;
 *     for a single-root project it is the repo itself. It always exists, so
 *     providers that require a single cwd have something to launch in.
 *   - `roots` is the authoritative list of folders the agent should be able to
 *     read and edit. Providers expose this natively (Claude `--add-dir` /
 *     `additionalDirectories`, Codex `skills/extraRoots/set`); providers that
 *     lack the mechanism degrade to the anchor alone.
 *   - `plainFolders` are the folders the `.code-workspace` lists that are not
 *     repositories and neither sit inside nor contain one. They are never copied: an isolated run works in the
 *     originals, beside its worktrees, and checkpoints do not cover them.
 *
 * Pure and provider-agnostic — the per-provider adapters consume the manifest.
 *
 * @module WorkspaceManifest
 */

export interface WorkspaceManifestRoot {
  /** Absolute path to the root folder. */
  readonly path: string;
  /** Display name (folder basename); used for provider manifests/labels. */
  readonly name: string;
}

export interface WorkspaceManifest {
  /** Stable launch directory (the `.code-workspace` file's dir, or the repo). */
  readonly anchor: string;
  /** Authoritative set of agent-visible roots, in order, deduped. */
  readonly roots: ReadonlyArray<WorkspaceManifestRoot>;
  /** Listed folders that exist and are not repositories, in file order, deduped. */
  readonly plainFolders: ReadonlyArray<WorkspaceManifestRoot>;
  /** Whether the roots are worktrees, which leaves `plainFolders` as shared originals. */
  readonly isolated: boolean;
}

function basenameOf(input: string): string {
  const normalized = input.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const base = separatorIndex === -1 ? normalized : normalized.slice(separatorIndex + 1);
  return base.length > 0 ? base : normalized;
}

function toRoots(paths: ReadonlyArray<string>): ReadonlyArray<WorkspaceManifestRoot> {
  const seen = new Set<string>();
  const roots: WorkspaceManifestRoot[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    roots.push({ path, name: basenameOf(path) });
  }
  return roots;
}

function isSameOrInside(candidate: string, parent: string): boolean {
  if (candidate === parent) return true;
  if (/[\\/]$/.test(parent)) return candidate.startsWith(parent);
  return candidate.startsWith(`${parent}/`) || candidate.startsWith(`${parent}\\`);
}

/** One folder a `.code-workspace` lists, as `WorkspaceFile.read` resolves it. */
export interface WorkspaceManifestFolder {
  readonly absolutePath: string;
  readonly exists: boolean;
  readonly isGit: boolean;
}

// A listed folder that is a repo root, or sits inside one, already belongs to
// that repository (and to its worktree in an isolated run), so it is not plain.
// A folder holding a repository is not plain either: granting it would hand an
// isolated run the original checkout. The repositories are the recorded
// `repoRoots` plus any listed git folder, which covers one added since.
function toPlainFolders(
  folders: ReadonlyArray<WorkspaceManifestFolder>,
  repoRoots: ReadonlyArray<string>,
): ReadonlyArray<WorkspaceManifestRoot> {
  const repositories = [
    ...repoRoots,
    ...folders
      .filter((folder) => folder.exists && folder.isGit)
      .map((folder) => folder.absolutePath),
  ];
  return toRoots(
    folders
      .filter(
        (folder) =>
          folder.exists &&
          !folder.isGit &&
          !repositories.some(
            (repository) =>
              isSameOrInside(folder.absolutePath, repository) ||
              isSameOrInside(repository, folder.absolutePath),
          ),
      )
      .map((folder) => folder.absolutePath),
  );
}

/** One isolated-run worktree, keyed by the repo root it was created from. */
export interface WorkspaceManifestWorktree {
  readonly repoRoot: string;
  readonly worktreePath: string;
}

/**
 * Build the resolved workspace manifest a provider session launches with.
 *
 * In isolated (worktree) mode the thread carries a per-root worktree map
 * (Phase 4 / D3): the manifest points the anchor and every root at the isolated
 * copies so the agent reads and edits the worktrees, not the originals. The
 * anchor prefers the worktree of the workspace root when one exists, otherwise
 * the first worktree. A legacy single `worktreePath` collapses to that copy.
 * Otherwise the manifest spans every `repoRoot`, falling back to
 * `[workspaceRoot]` when none are recorded (single-root and pre-migration
 * projects), preserving today's single-root launch behavior exactly.
 *
 * `workspaceFolders` is every folder the project's `.code-workspace` lists. The
 * ones that exist and are not repositories become `plainFolders` in every mode:
 * an isolated run keeps the originals beside its worktrees.
 */
export function buildWorkspaceManifest(input: {
  readonly worktreePath: string | null;
  readonly worktrees?: ReadonlyArray<WorkspaceManifestWorktree> | undefined;
  readonly workspaceRoot: string;
  readonly repoRoots: ReadonlyArray<string>;
  readonly workspaceFolders?: ReadonlyArray<WorkspaceManifestFolder> | undefined;
}): WorkspaceManifest {
  const plainFolders = toPlainFolders(input.workspaceFolders ?? [], input.repoRoots);
  const worktrees = input.worktrees ?? [];
  if (worktrees.length > 0) {
    const anchorEntry =
      worktrees.find((entry) => entry.repoRoot === input.workspaceRoot) ?? worktrees[0];
    const anchor = anchorEntry ? anchorEntry.worktreePath : input.workspaceRoot;
    return {
      anchor,
      roots: toRoots(worktrees.map((entry) => entry.worktreePath)),
      plainFolders,
      isolated: true,
    };
  }

  if (input.worktreePath) {
    return {
      anchor: input.worktreePath,
      roots: toRoots([input.worktreePath]),
      plainFolders,
      isolated: true,
    };
  }

  const rootPaths = input.repoRoots.length > 0 ? input.repoRoots : [input.workspaceRoot];
  return {
    anchor: input.workspaceRoot,
    roots: toRoots(rootPaths),
    plainFolders,
    isolated: false,
  };
}

/**
 * The plain folders to grant beside the extra roots. A plain folder inside the
 * anchor is left out, since the session already runs there.
 */
export function manifestPlainFolderGrants(manifest: WorkspaceManifest): ReadonlyArray<string> {
  return manifest.plainFolders
    .map((folder) => folder.path)
    .filter((path) => !isSameOrInside(path, manifest.anchor));
}

/**
 * The deduped set of directories to grant a provider that takes a primary cwd
 * plus extra roots (e.g. Claude `additionalDirectories`). Always includes the
 * anchor so single-root launches are byte-for-byte unchanged.
 */
export function manifestDirectories(
  manifest: Pick<WorkspaceManifest, "anchor" | "roots">,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const path of [manifest.anchor, ...manifest.roots.map((root) => root.path)]) {
    if (seen.has(path)) continue;
    seen.add(path);
    directories.push(path);
  }
  return directories;
}

/**
 * The extra roots to register with a provider whose primary cwd is the anchor
 * (e.g. Codex `skills/extraRoots/set`). Excludes the anchor itself, since the
 * session already runs there.
 */
export function manifestExtraRoots(
  manifest: Pick<WorkspaceManifest, "anchor" | "roots">,
): ReadonlyArray<string> {
  const seen = new Set<string>([manifest.anchor]);
  const roots: string[] = [];
  for (const root of manifest.roots) {
    if (seen.has(root.path)) continue;
    seen.add(root.path);
    roots.push(root.path);
  }
  return roots;
}
