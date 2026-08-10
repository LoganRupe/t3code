import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Migration0037 from "./037_ProjectionTurnsKeysetIndex.ts";
import Migration0038 from "./038_ProjectionThreadsPinOrderKey.ts";
import Migration0039 from "./039_ProjectionProjectsDefaultThreadEnvMode.ts";
import Migration0040 from "./040_ProjectionProjectFaviconPath.ts";

/**
 * Heals databases that skipped main's migrations because a branch build claimed
 * their id slots first.
 *
 * The multi-repo workspace migrations have been renumbered twice, and each time
 * they vacated a range of ids that machines running the older branch build had
 * already recorded in `effect_sql_migrations`. The migrator only runs files
 * whose numeric id exceeds the highest recorded id and never compares names, so
 * main's real migrations in those slots never ran on those machines and never
 * will:
 *
 * - 033-036 (Settled/Snoozed/TitleRegeneration/Pinned) were skipped on machines
 *   that ran the build numbering multi-repo 033-036. `projection_threads` ends
 *   up missing seven columns `ProjectionSnapshotQuery` selects, which fails
 *   statement preparation and crash-loops the server before it serves a client.
 * - 037-040 (TurnsKeysetIndex/PinOrderKey/DefaultThreadEnvMode/FaviconPath) were
 *   skipped on machines that ran the build numbering multi-repo 037-040, which
 *   is every machine that ran the branch between the two rebases.
 *
 * Healing 033-036 means adding their columns: each is a nullable TEXT
 * `ADD COLUMN` with no index or backfill. Healing 037-040 just re-runs them --
 * all four already guard on a `PRAGMA table_info` check or `IF NOT EXISTS`, so
 * running them a second time is defined behavior. Healthy databases have
 * everything already and this whole migration is a no-op.
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

  // 037-040. Each is already idempotent, so re-running is the whole heal: it
  // restores them on databases that recorded those ids under the multi-repo
  // names, and does nothing on databases that ran them for real.
  yield* Migration0037;
  yield* Migration0038;
  yield* Migration0039;
  yield* Migration0040;
});
