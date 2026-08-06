import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { detectMigrationLedgerDrift, migrationManifest, runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

// Each test gets its own in-memory database so ledger rows written by one case
// cannot satisfy or corrupt another.
const withDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  effect.pipe(Effect.provide(NodeSqliteClient.layerMemory()));

describe("migration ledger drift", () => {
  it.effect("reports nothing for a database migrated in order", () =>
    withDatabase(
      Effect.gen(function* () {
        yield* runMigrations();
        const drift = yield* detectMigrationLedgerDrift();
        assert.deepEqual(drift, []);
      }),
    ),
  );

  it.effect("reports the id, recorded name, and skipped migration", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 32 });
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (33, 'ProjectionProjectsRepoRoots')
        `;
        yield* runMigrations();

        const drift = yield* detectMigrationLedgerDrift();
        assert.deepEqual(drift, [
          { id: 33, recorded: "ProjectionProjectsRepoRoots", expected: "ProjectionThreadsSettled" },
        ]);
      }),
    ),
  );

  it.effect("treats ids beyond the manifest as a downgrade rather than drift", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const highestId = Math.max(...migrationManifest.map(([id]) => id));

        yield* runMigrations();
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (${highestId + 1}, 'FromANewerBuild')
        `;

        const drift = yield* detectMigrationLedgerDrift();
        assert.deepEqual(drift, []);
      }),
    ),
  );
});
