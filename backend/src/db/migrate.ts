//#region Why a static provider instead of FileMigrationProvider
// Kysely ships a FileMigrationProvider that scans a migrations/ directory at
// runtime and dynamically imports each file. That works under tsx in dev — but
// the production build is a SINGLE esbuild bundle (dist/server.js). There is no
// migrations/ directory in the prod image and no separate files to scan, so a
// path-based provider would find zero migrations and the app would run against
// an unmigrated database.
//
// So we register migrations EXPLICITLY, by import. esbuild follows these
// imports and inlines every migration into the bundle, so the exact same code
// path works in dev and prod. The cost is one line per migration here — a fair
// trade for "migrations are real code the bundler can see", and the explicit
// list doubles as the canonical ordering.
//#endregion

//#region Imports
import { Migrator, type Migration, type MigrationProvider } from "kysely"

import { db } from "./pool"

import * as m001 from "./migrations/001_initial_schema"
import * as m002 from "./migrations/002_email_at_rest"
import * as m003 from "./migrations/003_room_open_editing"
import * as m004 from "./migrations/004_canvas_dimension_bounds"
//#endregion

//#region Provider
// Keys are the migration NAMES Kysely records in the kysely_migration table and
// sorts lexicographically — hence the zero-padded numeric prefix. Never rename
// a key once it has run anywhere: Kysely would see the old name as a migration
// that has vanished and refuse to proceed.
//
// There is one entry because the original seven incremental migrations were
// squashed into a single baseline (no deployed database needed their
// step-by-step history). Adding the NEXT schema change means adding
// 002_*.ts here — not editing 001, which has now run.
const migrations: Record<string, Migration> = {
  "001_initial_schema": m001,
  "002_email_at_rest": m002,
  "003_room_open_editing": m003,
  "004_canvas_dimension_bounds": m004,
}

class ExplicitMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations
  }
}
//#endregion

//#region Runner
// Called once on startup, before the server accepts traffic. migrateToLatest
// runs every not-yet-applied migration in order, inside its own transaction per
// migration, and records each in kysely_migration. Running it again is a no-op.
export async function runMigrations(): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: new ExplicitMigrationProvider(),
  })

  const { error, results } = await migrator.migrateToLatest()

  for (const result of results ?? []) {
    if (result.status === "Success") {
      console.log(`migration applied: ${result.migrationName}`)
    } else if (result.status === "Error") {
      console.error(`migration FAILED: ${result.migrationName}`)
    }
  }

  if (error) {
    // Throw so startup aborts. A server that boots against a half-migrated or
    // unmigrated database will corrupt data or crash on the first query — far
    // better to fail loudly here and let the container restart policy retry.
    throw error
  }
}
//#endregion
