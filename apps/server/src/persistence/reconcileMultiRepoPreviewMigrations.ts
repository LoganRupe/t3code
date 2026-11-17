import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Preview builds of multi-repository projects recorded these migrations at ids main later gave to
 * other migrations (83/84, 86/87, 92/93). The migrator only runs ids above the highest recorded,
 * so those rows would skip main's migrations. Forgetting them lets main's run; the multi-repo
 * migrations are idempotent and record themselves again at their own ids.
 */
export const MULTI_REPO_MIGRATION_IDS: Readonly<Record<string, number>> = {
  ProjectionProjectsTrackedFolders: 98,
  TaskFolders: 99,
};

export const reconcileMultiRepoPreviewMigrations = Effect.fn("reconcileMultiRepoPreviewMigrations")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const ledger = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
    if (ledger.length === 0) return;
    for (const [name, id] of Object.entries(MULTI_REPO_MIGRATION_IDS)) {
      yield* sql`DELETE FROM effect_sql_migrations WHERE name = ${name} AND migration_id <> ${id}`;
    }
  },
);
