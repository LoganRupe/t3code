import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

interface PreviewTaskFolderEntry {
  readonly kind?: unknown;
  readonly name?: unknown;
  readonly originalPath?: unknown;
  readonly worktreePath?: unknown;
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/**
 * A row of the preview build's table (a Git home worktree plus one worktree per repository) in
 * this table's terms, or null when it does not have that shape.
 */
function convertPreviewTaskFolder(row: {
  readonly root: string;
  readonly repositories_json: string;
}): {
  readonly projectRoot: string;
  readonly anchor: string;
  readonly projectPath: string;
  readonly repositories: ReadonlyArray<{
    repositoryPath: string;
    worktreePath: string;
    name: string;
  }>;
} | null {
  let entries: unknown;
  try {
    entries = JSON.parse(row.repositories_json);
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;
  const typed = entries as ReadonlyArray<PreviewTaskFolderEntry>;
  const home = typed.find((entry) => entry.kind === "home");
  if (!home || !isText(home.originalPath) || !isText(home.worktreePath)) return null;
  // The home worktree sits at the same place below `root` as the project folder below the anchor.
  const homeBelowRoot = NodePath.relative(row.root, home.worktreePath);
  if (homeBelowRoot.startsWith("..") || NodePath.isAbsolute(homeBelowRoot)) return null;
  let anchor = home.originalPath;
  for (const segment of homeBelowRoot.split(NodePath.sep)) {
    if (segment.length > 0) anchor = NodePath.dirname(anchor);
  }
  const repositories = typed.flatMap((entry) =>
    entry.kind === "repository" &&
    isText(entry.originalPath) &&
    isText(entry.worktreePath) &&
    isText(entry.name)
      ? [{ repositoryPath: entry.originalPath, worktreePath: entry.worktreePath, name: entry.name }]
      : [],
  );
  return { projectRoot: home.originalPath, anchor, projectPath: home.worktreePath, repositories };
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(task_folders)`;
  // A preview build created this table with another shape. Its rows still describe worktrees on
  // disk, so they move to the new shape; the old table stays as task_folders_preview.
  const previewShape = columns.length > 0 && !columns.some((column) => column.name === "real_root");
  if (previewShape) yield* sql`ALTER TABLE task_folders RENAME TO task_folders_preview`;
  // Keyed by folder: subagents, forks and reused worktrees share one path across threads.
  yield* sql`
    CREATE TABLE IF NOT EXISTS task_folders (
      root TEXT PRIMARY KEY,
      real_root TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_root TEXT NOT NULL,
      anchor TEXT NOT NULL,
      project_path TEXT NOT NULL,
      project_is_worktree INTEGER NOT NULL,
      repositories_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_task_folders_real_root ON task_folders (real_root)`;
  if (!previewShape) return;
  const rows = yield* sql<{
    readonly root: string;
    readonly project_id: string;
    readonly repositories_json: string;
    readonly created_at: string;
  }>`SELECT root, project_id, repositories_json, created_at FROM task_folders_preview`;
  for (const row of rows) {
    const converted = convertPreviewTaskFolder(row);
    if (converted === null) continue;
    yield* sql`
      INSERT OR IGNORE INTO task_folders (
        root, real_root, project_id, project_root, anchor, project_path,
        project_is_worktree, repositories_json, created_at
      ) VALUES (
        ${row.root}, ${row.root}, ${row.project_id}, ${converted.projectRoot}, ${converted.anchor},
        ${converted.projectPath}, 1, ${JSON.stringify(converted.repositories)}, ${row.created_at}
      )
    `;
  }
});
