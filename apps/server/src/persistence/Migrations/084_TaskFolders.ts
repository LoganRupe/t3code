import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Multi-repo worktree folders, keyed by their root. Rows describe filesystem state that the
  // task folder service creates and removes, so they live beside it instead of in projections.
  yield* sql`
    CREATE TABLE IF NOT EXISTS task_folders (
      root TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      home_worktree_path TEXT NOT NULL,
      repositories_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_task_folders_project_id ON task_folders (project_id)
  `;
});
