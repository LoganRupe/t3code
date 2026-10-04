import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

const recordForkMigrations = (rows: ReadonlyArray<readonly [number, string]>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`ALTER TABLE projection_projects ADD COLUMN repo_roots TEXT NOT NULL DEFAULT '[]'`;
    yield* sql`ALTER TABLE projection_projects ADD COLUMN workspace_file TEXT`;
    yield* sql`ALTER TABLE projection_threads ADD COLUMN worktrees_json TEXT NOT NULL DEFAULT '[]'`;
    for (const [id, name] of rows) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }
  });

const ledger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const v2TableExists = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'orchestration_v2_projection_threads'
  `;
  return rows.length === 1;
});

describe("multi-repo fork ledger repair", () => {
  it.effect("hands back 52-59 fork ledgers whose heal never re-ran main's 52-54", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 51 });
      yield* recordForkMigrations([
        [52, "ProjectionProjectsRepoRoots"],
        [53, "ProjectionProjectsWorkspaceFile"],
        [54, "ProjectionCheckpointRefs"],
        [55, "ProjectionThreadsWorktrees"],
        [56, "HealSkippedRenumberedMigrations"],
        [57, "ProjectionThreadsWorktrees"],
        [58, "HealSkippedRenumberedMigrations"],
        [59, "HealSkippedRenumberedMigrations"],
      ]);

      yield* runMigrations();

      assert.deepStrictEqual(yield* ledger, migrationManifest);
      assert.isTrue(yield* v2TableExists);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("hands back ledgers that kept main's 52-54 and put the fork at 55-59", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* recordForkMigrations([
        [55, "ProjectionProjectsRepoRoots"],
        [56, "ProjectionProjectsWorkspaceFile"],
        [57, "ProjectionCheckpointRefs"],
        [58, "ProjectionThreadsWorktrees"],
        [59, "HealSkippedRenumberedMigrations"],
      ]);

      yield* runMigrations();

      assert.deepStrictEqual(yield* ledger, migrationManifest);
      assert.isTrue(yield* v2TableExists);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("leaves databases that never ran the fork alone", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        (yield* runMigrations()).map(([id]) => id),
        migrationManifest.map(([id]) => id),
      );
      assert.deepStrictEqual(yield* ledger, migrationManifest);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});
