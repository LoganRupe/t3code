import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const HEALED_COLUMNS = [
  "settled_override",
  "settled_at",
  "snoozed_until",
  "snoozed_at",
  "title_regeneration_request_id",
  "title_regeneration_started_at",
  "pinned_at",
] as const;

const threadColumns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  return new Set(columns.map((column) => column.name));
});

const projectColumns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  return new Set(columns.map((column) => column.name));
});

const turnIndexes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const indexes = yield* sql<{ readonly name: string }>`
    PRAGMA index_list(projection_turns)
  `;
  return new Set(indexes.map((index) => index.name));
});

// Each test gets its own in-memory database; a shared one would let the drift
// reproduced below leak into the healthy-database case and pass it vacuously.
const withDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  effect.pipe(Effect.provide(NodeSqliteClient.layerMemory()));

describe("045_HealSkippedRenumberedMigrations", () => {
  it.effect("restores columns on a database that skipped migrations 033-036", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // Reproduce the drift: migrate through 032, then claim slots 33-36
        // under the pre-rebase multi-repo names so the real 033-036 are
        // skipped exactly as they were on affected machines.
        yield* runMigrations({ toMigrationInclusive: 32 });
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name) VALUES
            (33, 'ProjectionProjectsRepoRoots'),
            (34, 'ProjectionProjectsWorkspaceFile'),
            (35, 'ProjectionCheckpointRefs'),
            (36, 'ProjectionThreadsWorktrees')
        `;

        yield* runMigrations({ toMigrationInclusive: 44 });
        const beforeHeal = yield* threadColumns;
        for (const column of HEALED_COLUMNS) {
          assert.ok(!beforeHeal.has(column), `expected ${column} to be missing before healing`);
        }

        yield* runMigrations({ toMigrationInclusive: 45 });
        const afterHeal = yield* threadColumns;
        for (const column of HEALED_COLUMNS) {
          assert.ok(afterHeal.has(column), `expected ${column} to be restored`);
        }
      }),
    ),
  );

  it.effect("restores schema on a database that skipped migrations 037-040", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // The second renumbering: machines that ran the branch between the two
        // rebases recorded 37-40 under the multi-repo names, so main's real
        // 037-040 were skipped.
        yield* runMigrations({ toMigrationInclusive: 36 });
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name) VALUES
            (37, 'ProjectionProjectsRepoRoots'),
            (38, 'ProjectionProjectsWorkspaceFile'),
            (39, 'ProjectionCheckpointRefs'),
            (40, 'ProjectionThreadsWorktrees')
        `;

        yield* runMigrations({ toMigrationInclusive: 44 });
        assert.ok(
          !(yield* threadColumns).has("pin_order_key"),
          "expected pin_order_key to be missing before healing",
        );
        const projectColumnsBefore = yield* projectColumns;
        assert.ok(
          !projectColumnsBefore.has("default_thread_env_mode"),
          "expected default_thread_env_mode to be missing before healing",
        );
        assert.ok(
          !projectColumnsBefore.has("favicon_path"),
          "expected favicon_path to be missing before healing",
        );
        assert.ok(
          !(yield* turnIndexes).has("idx_projection_turns_thread_keyset"),
          "expected the turns keyset index to be missing before healing",
        );

        yield* runMigrations({ toMigrationInclusive: 45 });
        assert.ok((yield* threadColumns).has("pin_order_key"), "expected pin_order_key restored");
        const projectColumnsAfter = yield* projectColumns;
        assert.ok(
          projectColumnsAfter.has("default_thread_env_mode"),
          "expected default_thread_env_mode restored",
        );
        assert.ok(projectColumnsAfter.has("favicon_path"), "expected favicon_path restored");
        assert.ok(
          (yield* turnIndexes).has("idx_projection_turns_thread_keyset"),
          "expected the turns keyset index restored",
        );
      }),
    ),
  );

  it.effect("is a no-op on a healthy database", () =>
    withDatabase(
      Effect.gen(function* () {
        yield* runMigrations({ toMigrationInclusive: 44 });
        const beforeHeal = yield* threadColumns;
        for (const column of HEALED_COLUMNS) {
          assert.ok(beforeHeal.has(column), `expected ${column} to already exist`);
        }

        yield* runMigrations({ toMigrationInclusive: 45 });
        const afterHeal = yield* threadColumns;

        assert.deepEqual([...afterHeal].sort(), [...beforeHeal].sort());
      }),
    ),
  );
});
