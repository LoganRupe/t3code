import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import PullRequestFilesViewed from "./Migrations/053_PullRequestFilesViewed.ts";
import AutoSettleDisabledAt from "./Migrations/054_ProjectionThreadsAutoSettleDisabledAt.ts";

// Names the pre-V2 multi-repo fork recorded at ids that main later assigned to its own
// migrations (52 onward). Their schema additions are optional columns and one unused table,
// so they can stay in place.
const FORK_MIGRATION_NAMES = new Set([
  "ProjectionProjectsRepoRoots",
  "ProjectionProjectsWorkspaceFile",
  "ProjectionCheckpointRefs",
  "ProjectionThreadsWorktrees",
  "HealSkippedRenumberedMigrations",
]);

// Main's migrations the fork's heal step already applied, whatever ids the fork recorded.
const MAIN_MIGRATIONS = [
  [52, "ProjectionThreadTitleState"],
  [53, "PullRequestFilesViewed"],
  [54, "ProjectionThreadsAutoSettleDisabledAt"],
] as const;

/**
 * Hands databases that ran the pre-V2 multi-repo fork back to main's migration ledger.
 *
 * Depending on the build, the fork recorded its own migrations at 52-59 or 55-59, and re-ran
 * main's 52-54 inside `HealSkippedRenumberedMigrations`. Left alone, the migrator would treat 55
 * (OrchestrationV2) and 56 as already applied. This re-asserts 52-54, which is idempotent,
 * replaces the fork rows with main's names, and lets the migrator run 55 onward normally.
 */
export const reconcileMultiRepoForkMigrations = Effect.fn("reconcileMultiRepoForkMigrations")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables = yield* sql`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
        `;
        if (tables.length === 0) return [];
        const history = yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id >= 52
        `;
        const forkRows = history.filter((row) => FORK_MIGRATION_NAMES.has(row.name));
        if (forkRows.length === 0) return [];
        const later = history.filter(
          (row) =>
            !FORK_MIGRATION_NAMES.has(row.name) &&
            !MAIN_MIGRATIONS.some(([id, name]) => id === row.migration_id && name === row.name),
        );
        if (later.length > 0) {
          // A state this repair does not know. Leave it to the divergence warning.
          yield* Effect.logWarning(
            "Skipping multi-repo fork ledger repair: unexpected migrations recorded past 51.",
          ).pipe(
            Effect.annotateLogs({ later: later.map((row) => `${row.migration_id}:${row.name}`) }),
          );
          return [];
        }

        const threadColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_threads)
        `;
        if (!threadColumns.some((column) => column.name === "title_state_json")) {
          yield* sql`ALTER TABLE projection_threads ADD COLUMN title_state_json TEXT`;
        }
        yield* PullRequestFilesViewed;
        yield* AutoSettleDisabledAt;

        for (const row of forkRows) {
          yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = ${row.migration_id}`;
        }
        const restored = MAIN_MIGRATIONS.filter(
          ([id]) =>
            !history.some((row) => row.migration_id === id && !FORK_MIGRATION_NAMES.has(row.name)),
        );
        for (const [id, name] of restored) {
          yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
        }
        yield* Effect.logWarning("Repaired migration ledger left by the multi-repo fork.").pipe(
          Effect.annotateLogs({
            removed: forkRows.map((row) => `${row.migration_id}:${row.name}`),
          }),
        );
        return restored.map(([id, name]) => [id, name] as const);
      }),
    );
  },
);
