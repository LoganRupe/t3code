import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Heals databases that skipped migrations 033-036.
 *
 * The multi-repo workspace migrations were originally numbered 033-036 and
 * shipped in pre-rebase branch builds, so those slots were recorded in
 * `effect_sql_migrations` on any machine that ran one. After the rebase they
 * were renumbered to 037-040, but the migrator only runs files whose numeric id
 * exceeds the highest recorded id -- so main's real 033-036
 * (Settled/Snoozed/TitleRegeneration/Pinned) never ran on those machines and
 * never will. The result is a `projection_threads` table missing seven columns
 * that `ProjectionSnapshotQuery` selects, which fails statement preparation and
 * crash-loops the server before it can serve the client.
 *
 * Adding the columns here is equivalent to letting 033-036 run: every one of
 * them is a nullable TEXT `ADD COLUMN` with no index or backfill. Healthy
 * databases already have all seven and this is a no-op.
 *
 * Migration ids are immutable once any build has applied them -- including a
 * branch build. When rebasing, append after main's highest id rather than
 * renumbering into slots main has since claimed.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const existing = new Set(columns.map((column) => column.name));
  const healed: Array<string> = [];

  // 033_ProjectionThreadsSettled
  if (!existing.has("settled_override")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN settled_override TEXT`;
    healed.push("settled_override");
  }
  if (!existing.has("settled_at")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN settled_at TEXT`;
    healed.push("settled_at");
  }

  // 034_ProjectionThreadsSnoozed
  if (!existing.has("snoozed_until")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN snoozed_until TEXT`;
    healed.push("snoozed_until");
  }
  if (!existing.has("snoozed_at")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN snoozed_at TEXT`;
    healed.push("snoozed_at");
  }

  // 035_ProjectionThreadTitleRegeneration
  if (!existing.has("title_regeneration_request_id")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN title_regeneration_request_id TEXT`;
    healed.push("title_regeneration_request_id");
  }
  if (!existing.has("title_regeneration_started_at")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN title_regeneration_started_at TEXT`;
    healed.push("title_regeneration_started_at");
  }

  // 036_ProjectionThreadsPinned
  if (!existing.has("pinned_at")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN pinned_at TEXT`;
    healed.push("pinned_at");
  }

  if (healed.length > 0) {
    yield* Effect.logWarning(
      "Healed projection_threads columns skipped by renumbered migrations 033-036",
    ).pipe(Effect.annotateLogs({ columns: healed }));
  }
});
