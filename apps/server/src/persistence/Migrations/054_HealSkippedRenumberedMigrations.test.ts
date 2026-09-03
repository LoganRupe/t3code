import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

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

const authSessionColumns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_sessions)
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

describe("054_HealSkippedRenumberedMigrations", () => {
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

        yield* runMigrations({ toMigrationInclusive: 51 });
        const beforeHeal = yield* threadColumns;
        for (const column of HEALED_COLUMNS) {
          assert.ok(!beforeHeal.has(column), `expected ${column} to be missing before healing`);
        }

        yield* runMigrations({ toMigrationInclusive: 52 });
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

        yield* runMigrations({ toMigrationInclusive: 51 });
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

        yield* runMigrations({ toMigrationInclusive: 52 });
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

  it.effect("restores schema on a database that skipped migration 041", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // The third renumbering: machines that ran the branch before this
        // rebase recorded 41-45 under the multi-repo names, so main's real
        // 041_AuthSessionClientConnection was skipped.
        yield* runMigrations({ toMigrationInclusive: 40 });
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name) VALUES
            (41, 'ProjectionProjectsRepoRoots'),
            (42, 'ProjectionProjectsWorkspaceFile'),
            (43, 'ProjectionCheckpointRefs'),
            (44, 'ProjectionThreadsWorktrees'),
            (45, 'HealSkippedRenumberedMigrations')
        `;

        const beforeHeal = yield* authSessionColumns;
        assert.ok(
          !beforeHeal.has("client_surface"),
          "expected client_surface to be missing before healing",
        );
        assert.ok(
          !beforeHeal.has("client_app_version"),
          "expected client_app_version to be missing before healing",
        );

        yield* runMigrations({ toMigrationInclusive: 52 });
        const afterHeal = yield* authSessionColumns;
        assert.ok(afterHeal.has("client_surface"), "expected client_surface restored");
        assert.ok(afterHeal.has("client_app_version"), "expected client_app_version restored");
      }),
    ),
  );

  it.effect("restores schema on a database that skipped migrations 042-043", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // The fourth renumbering: machines that ran the branch before this
        // rebase recorded 42-46 under the multi-repo names, so main's real
        // 042_ProjectionThreadLinkedPullRequest and 043_ProjectionThreadsUnsettledAt
        // were skipped.
        yield* runMigrations({ toMigrationInclusive: 41 });
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name) VALUES
            (42, 'ProjectionProjectsWorkspaceFile'),
            (43, 'ProjectionCheckpointRefs'),
            (44, 'ProjectionThreadsWorktrees'),
            (45, 'HealSkippedRenumberedMigrations'),
            (46, 'HealSkippedRenumberedMigrations')
        `;

        const beforeHeal = yield* threadColumns;
        assert.ok(
          !beforeHeal.has("linked_pull_request_json"),
          "expected linked_pull_request_json to be missing before healing",
        );
        assert.ok(
          !beforeHeal.has("unsettled_at"),
          "expected unsettled_at to be missing before healing",
        );

        yield* runMigrations({ toMigrationInclusive: 52 });
        const afterHeal = yield* threadColumns;
        assert.ok(
          afterHeal.has("linked_pull_request_json"),
          "expected linked_pull_request_json restored",
        );
        assert.ok(afterHeal.has("unsettled_at"), "expected unsettled_at restored");
      }),
    ),
  );

  it.effect("restores schema on a database that skipped migrations 044-047", () =>
    withDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // The fifth renumbering: machines that ran the branch before this
        // rebase recorded 44-48 under the multi-repo names, so main's real
        // 044-047 were skipped. This is the shape of Logan's own ledger.
        yield* runMigrations({ toMigrationInclusive: 43 });
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name) VALUES
            (44, 'ProjectionProjectsRepoRoots'),
            (45, 'ProjectionProjectsWorkspaceFile'),
            (46, 'ProjectionCheckpointRefs'),
            (47, 'ProjectionThreadsWorktrees'),
            (48, 'HealSkippedRenumberedMigrations')
        `;

        const beforeHeal = yield* projectColumns;
        assert.ok(!beforeHeal.has("auto_pull"), "expected auto_pull to be missing before healing");
        assert.ok(
          !beforeHeal.has("project_icon_json"),
          "expected project_icon_json to be missing before healing",
        );

        yield* runMigrations({ toMigrationInclusive: 52 });
        const afterHeal = yield* projectColumns;
        assert.ok(afterHeal.has("auto_pull"), "expected auto_pull restored");
        assert.ok(afterHeal.has("project_icon_json"), "expected project_icon_json restored");
      }),
    ),
  );

  it.effect("is a no-op on a healthy database", () =>
    withDatabase(
      Effect.gen(function* () {
        yield* runMigrations({ toMigrationInclusive: 51 });
        const beforeHeal = yield* threadColumns;
        for (const column of HEALED_COLUMNS) {
          assert.ok(beforeHeal.has(column), `expected ${column} to already exist`);
        }

        yield* runMigrations({ toMigrationInclusive: 52 });
        const afterHeal = yield* threadColumns;

        assert.deepEqual([...afterHeal].sort(), [...beforeHeal].sort());
      }),
    ),
  );
});
