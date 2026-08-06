/**
 * MigrationsLive - Migration runner with inline loader
 *
 * Uses Migrator.make with fromRecord to define migrations inline.
 * All migrations are statically imported - no dynamic file system loading.
 *
 * Migrations run automatically when the MigrationLayer is provided,
 * ensuring the database schema is always up-to-date before the application starts.
 */

import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

// Import all migrations statically
import Migration0001 from "./Migrations/001_OrchestrationEvents.ts";
import Migration0002 from "./Migrations/002_OrchestrationCommandReceipts.ts";
import Migration0003 from "./Migrations/003_CheckpointDiffBlobs.ts";
import Migration0004 from "./Migrations/004_ProviderSessionRuntime.ts";
import Migration0005 from "./Migrations/005_Projections.ts";
import Migration0006 from "./Migrations/006_ProjectionThreadSessionRuntimeModeColumns.ts";
import Migration0007 from "./Migrations/007_ProjectionThreadMessageAttachments.ts";
import Migration0008 from "./Migrations/008_ProjectionThreadActivitySequence.ts";
import Migration0009 from "./Migrations/009_ProviderSessionRuntimeMode.ts";
import Migration0010 from "./Migrations/010_ProjectionThreadsRuntimeMode.ts";
import Migration0011 from "./Migrations/011_OrchestrationThreadCreatedRuntimeMode.ts";
import Migration0012 from "./Migrations/012_ProjectionThreadsInteractionMode.ts";
import Migration0013 from "./Migrations/013_ProjectionThreadProposedPlans.ts";
import Migration0014 from "./Migrations/014_ProjectionThreadProposedPlanImplementation.ts";
import Migration0015 from "./Migrations/015_ProjectionTurnsSourceProposedPlan.ts";
import Migration0016 from "./Migrations/016_CanonicalizeModelSelections.ts";
import Migration0017 from "./Migrations/017_ProjectionThreadsArchivedAt.ts";
import Migration0018 from "./Migrations/018_ProjectionThreadsArchivedAtIndex.ts";
import Migration0019 from "./Migrations/019_ProjectionSnapshotLookupIndexes.ts";
import Migration0020 from "./Migrations/020_AuthAccessManagement.ts";
import Migration0021 from "./Migrations/021_AuthSessionClientMetadata.ts";
import Migration0022 from "./Migrations/022_AuthSessionLastConnectedAt.ts";
import Migration0023 from "./Migrations/023_ProjectionThreadShellSummary.ts";
import Migration0024 from "./Migrations/024_BackfillProjectionThreadShellSummary.ts";
import Migration0025 from "./Migrations/025_CleanupInvalidProjectionPendingApprovals.ts";
import Migration0026 from "./Migrations/026_CanonicalizeModelSelectionOptions.ts";
import Migration0027 from "./Migrations/027_ProviderSessionRuntimeInstanceId.ts";
import Migration0028 from "./Migrations/028_ProjectionThreadSessionInstanceId.ts";
import Migration0029 from "./Migrations/029_ProjectionThreadDetailOrderingIndexes.ts";
import Migration0030 from "./Migrations/030_ProjectionThreadShellArchiveIndexes.ts";
import Migration0031 from "./Migrations/031_AuthAuthorizationScopes.ts";
import Migration0032 from "./Migrations/032_AuthPairingProofKeyThumbprint.ts";
import Migration0033 from "./Migrations/033_ProjectionThreadsSettled.ts";
import Migration0034 from "./Migrations/034_ProjectionThreadsSnoozed.ts";
import Migration0035 from "./Migrations/035_ProjectionThreadTitleRegeneration.ts";
import Migration0036 from "./Migrations/036_ProjectionThreadsPinned.ts";
import Migration0037 from "./Migrations/037_ProjectionTurnsKeysetIndex.ts";
import Migration0038 from "./Migrations/038_ProjectionThreadsPinOrderKey.ts";
import Migration0039 from "./Migrations/039_ProjectionProjectsDefaultThreadEnvMode.ts";
import Migration0040 from "./Migrations/040_ProjectionProjectFaviconPath.ts";
import Migration0041 from "./Migrations/041_AuthSessionClientConnection.ts";
import Migration0042 from "./Migrations/042_ProjectionThreadLinkedPullRequest.ts";
import Migration0043 from "./Migrations/043_ProjectionThreadsUnsettledAt.ts";
import Migration0044 from "./Migrations/044_ProjectionProjectsRepoRoots.ts";
import Migration0045 from "./Migrations/045_ProjectionProjectsWorkspaceFile.ts";
import Migration0046 from "./Migrations/046_ProjectionCheckpointRefs.ts";
import Migration0047 from "./Migrations/047_ProjectionThreadsWorktrees.ts";
import Migration0048 from "./Migrations/048_HealSkippedProjectionThreadColumns.ts";

/**
 * Migration loader with all migrations defined inline.
 *
 * Key format: "{id}_{name}" where:
 * - id: numeric migration ID (determines execution order)
 * - name: descriptive name for the migration
 *
 * Uses Migrator.fromRecord which parses the key format and
 * returns migrations sorted by ID.
 *
 * Ids are immutable once any build has applied them, including a branch build
 * a teammate ran locally. The migrator only runs ids greater than the highest
 * one recorded in `effect_sql_migrations` and never compares names, so
 * renumbering a migration into a slot another branch has since claimed makes it
 * silently unrunnable on every database that saw the old numbering. When
 * rebasing a branch that adds migrations, append after main's highest id rather
 * than renumbering. `detectMigrationLedgerDrift` reports this if it happens
 * anyway; 048_HealSkippedProjectionThreadColumns repairs the 033-036 occurrence.
 */
export const migrationEntries = [
  [1, "OrchestrationEvents", Migration0001],
  [2, "OrchestrationCommandReceipts", Migration0002],
  [3, "CheckpointDiffBlobs", Migration0003],
  [4, "ProviderSessionRuntime", Migration0004],
  [5, "Projections", Migration0005],
  [6, "ProjectionThreadSessionRuntimeModeColumns", Migration0006],
  [7, "ProjectionThreadMessageAttachments", Migration0007],
  [8, "ProjectionThreadActivitySequence", Migration0008],
  [9, "ProviderSessionRuntimeMode", Migration0009],
  [10, "ProjectionThreadsRuntimeMode", Migration0010],
  [11, "OrchestrationThreadCreatedRuntimeMode", Migration0011],
  [12, "ProjectionThreadsInteractionMode", Migration0012],
  [13, "ProjectionThreadProposedPlans", Migration0013],
  [14, "ProjectionThreadProposedPlanImplementation", Migration0014],
  [15, "ProjectionTurnsSourceProposedPlan", Migration0015],
  [16, "CanonicalizeModelSelections", Migration0016],
  [17, "ProjectionThreadsArchivedAt", Migration0017],
  [18, "ProjectionThreadsArchivedAtIndex", Migration0018],
  [19, "ProjectionSnapshotLookupIndexes", Migration0019],
  [20, "AuthAccessManagement", Migration0020],
  [21, "AuthSessionClientMetadata", Migration0021],
  [22, "AuthSessionLastConnectedAt", Migration0022],
  [23, "ProjectionThreadShellSummary", Migration0023],
  [24, "BackfillProjectionThreadShellSummary", Migration0024],
  [25, "CleanupInvalidProjectionPendingApprovals", Migration0025],
  [26, "CanonicalizeModelSelectionOptions", Migration0026],
  [27, "ProviderSessionRuntimeInstanceId", Migration0027],
  [28, "ProjectionThreadSessionInstanceId", Migration0028],
  [29, "ProjectionThreadDetailOrderingIndexes", Migration0029],
  [30, "ProjectionThreadShellArchiveIndexes", Migration0030],
  [31, "AuthAuthorizationScopes", Migration0031],
  [32, "AuthPairingProofKeyThumbprint", Migration0032],
  [33, "ProjectionThreadsSettled", Migration0033],
  [34, "ProjectionThreadsSnoozed", Migration0034],
  [35, "ProjectionThreadTitleRegeneration", Migration0035],
  [36, "ProjectionThreadsPinned", Migration0036],
  [37, "ProjectionTurnsKeysetIndex", Migration0037],
  [38, "ProjectionThreadsPinOrderKey", Migration0038],
  [39, "ProjectionProjectsDefaultThreadEnvMode", Migration0039],
  [40, "ProjectionProjectFaviconPath", Migration0040],
  [41, "AuthSessionClientConnection", Migration0041],
  [42, "ProjectionThreadLinkedPullRequest", Migration0042],
  [43, "ProjectionThreadsUnsettledAt", Migration0043],
  [44, "ProjectionProjectsRepoRoots", Migration0044],
  [45, "ProjectionProjectsWorkspaceFile", Migration0045],
  [46, "ProjectionCheckpointRefs", Migration0046],
  [47, "ProjectionThreadsWorktrees", Migration0047],
  [48, "HealSkippedProjectionThreadColumns", Migration0048],
] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

const migrationNamesById = new Map<number, string>(migrationManifest);

export interface MigrationLedgerDrift {
  readonly id: number;
  readonly recorded: string;
  readonly expected: string;
}

/**
 * Compare the recorded ledger against the manifest and report id/name drift.
 *
 * The migrator runs any migration whose numeric id exceeds the highest recorded
 * id and never compares names, so an id recorded under a different name is
 * silently permanent: the manifest migration for that id has already been
 * skipped and will never run again. That surfaces much later as a missing
 * column at query time, which reads like a corrupt database rather than a
 * migration problem. Drift only happens when a migration is renumbered after a
 * build has applied it -- see 041_HealSkippedProjectionThreadColumns.
 *
 * Reporting is deliberately non-fatal, and a warning rather than an error.
 * Machines that already have drift need to boot so their healing migrations can
 * run -- failing here would brick exactly the databases that are recoverable.
 * Drift is also permanent once healed, because the recorded names cannot be
 * corrected without rewriting the ledger, so anything louder would fire on
 * every boot of a database that is actually fine.
 */
export const detectMigrationLedgerDrift = Effect.fn("detectMigrationLedgerDrift")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`;

  return rows.flatMap((row): ReadonlyArray<MigrationLedgerDrift> => {
    const expected = migrationNamesById.get(row.migration_id);
    // An id past the end of the manifest means the database was written by a
    // newer build; that is a downgrade, not drift.
    if (expected === undefined || expected === row.name) return [];
    return [{ id: row.migration_id, recorded: row.name, expected }];
  });
});

const reportMigrationLedgerDrift = Effect.fn("reportMigrationLedgerDrift")(function* () {
  const drift = yield* detectMigrationLedgerDrift();
  if (drift.length === 0) return;

  yield* Effect.logWarning(
    "Migration ledger drift: these ids were recorded under a different migration name, " +
      "so the manifest migration for each was skipped and will not run again. If a column " +
      "is missing at query time, add a healing migration rather than renumbering",
  ).pipe(
    Effect.annotateLogs({
      drift: drift.map(
        ({ id, recorded, expected }) => `${id}: recorded ${recorded}, expected ${expected}`,
      ),
      skipped: drift.map(({ id, expected }) => `${id}_${expected}`),
    }),
  );
});

export const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

/**
 * Migrator run function - no schema dumping needed
 * Uses the base Migrator.make without platform dependencies
 */
const run = Migrator.make({});

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run all pending migrations.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 *
 * @returns Effect containing array of executed migrations
 */
export const runMigrations = Effect.fn("runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  const executedMigrations = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));

  // Diagnostic only, and reported after the run so healing migrations have
  // already applied. Never allowed to fail startup.
  yield* reportMigrationLedgerDrift().pipe(
    Effect.catchCause((cause) =>
      Effect.logDebug("Could not check migration ledger for drift").pipe(
        Effect.annotateLogs({ cause }),
      ),
    ),
  );

  return executedMigrations;
});

/**
 * Layer that runs migrations when the layer is built.
 *
 * Use this to ensure migrations run before your application starts.
 * Migrations are run automatically - no separate script is needed.
 *
 * @example
 * ```typescript
 * import { MigrationsLive } from "@acme/db/Migrations"
 * import * as SqliteClient from "@acme/db/SqliteClient"
 *
 * // Migrations run automatically when SqliteClient is provided
 * const AppLayer = MigrationsLive.pipe(
 *   Layer.provideMerge(SqliteClient.layer({ filename: "database.sqlite" }))
 * )
 * ```
 */
export const MigrationsLive = Layer.effectDiscard(runMigrations());
