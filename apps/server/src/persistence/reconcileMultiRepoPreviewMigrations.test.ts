import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "./Migrations.ts";

// The 0.1.9 multi-repo preview: main through 82, then its own tracked folders and task folders
// recorded at 83 and 84, with a task folder of the shape it wrote.
const seedPreview = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runMigrations({ toMigrationInclusive: 82 });
  yield* sql`
    ALTER TABLE projection_projects ADD COLUMN tracked_folders_json TEXT NOT NULL DEFAULT '[]'
  `;
  yield* sql`
    CREATE TABLE task_folders (
      root TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      home_worktree_path TEXT NOT NULL,
      repositories_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  const repositories = JSON.stringify([
    {
      kind: "home",
      name: "PHCPaymentsWorkspace",
      originalPath: "/repos/_workspaces/PHCPaymentsWorkspace",
      worktreePath: "/wt/t3-1/_workspaces/PHCPaymentsWorkspace",
      relativePath: "",
      baseRef: "main",
      branch: "t3/x",
    },
    {
      kind: "repository",
      name: "PaymentsApp",
      originalPath: "/repos/djpr/PaymentsApp",
      worktreePath: "/wt/t3-1/djpr/PaymentsApp",
      relativePath: "../../djpr/PaymentsApp",
      baseRef: "main",
      branch: "t3/x",
    },
  ]);
  yield* sql`
    INSERT INTO task_folders VALUES (
      '/wt/t3-1', 'project-1', '/wt/t3-1/_workspaces/PHCPaymentsWorkspace', ${repositories},
      '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z'
    )
  `;
  yield* sql`
    INSERT INTO effect_sql_migrations (migration_id, name)
    VALUES (83, 'ProjectionProjectsTrackedFolders'), (84, 'TaskFolders')
  `;
});

describe("multi-repo preview upgrade", () => {
  it.effect("runs main's migrations at the ids the preview took and keeps its task folders", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* seedPreview;
      const ran = (yield* runMigrations()).map(([id]) => id);
      assert.include(ran, 83);
      assert.include(ran, 84);
      assert.include(ran, 99);
      const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations
        WHERE name IN ('ProjectionProjectsTrackedFolders', 'TaskFolders', 'CommandReadIndexes')
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        ledger.map((row) => [row.migration_id, row.name]),
        [
          [83, "CommandReadIndexes"],
          [98, "ProjectionProjectsTrackedFolders"],
          [99, "TaskFolders"],
        ],
      );
      const folders = yield* sql`SELECT * FROM task_folders`;
      assert.deepStrictEqual(folders, [
        {
          root: "/wt/t3-1",
          real_root: "/wt/t3-1",
          project_id: "project-1",
          project_root: "/repos/_workspaces/PHCPaymentsWorkspace",
          anchor: "/repos",
          project_path: "/wt/t3-1/_workspaces/PHCPaymentsWorkspace",
          project_is_worktree: 1,
          repositories_json: JSON.stringify([
            {
              repositoryPath: "/repos/djpr/PaymentsApp",
              worktreePath: "/wt/t3-1/djpr/PaymentsApp",
              name: "PaymentsApp",
            },
          ]),
          created_at: "2026-11-10T00:00:00.000Z",
        },
      ]);
      assert.lengthOf(yield* sql`SELECT * FROM task_folders_preview`, 1);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
