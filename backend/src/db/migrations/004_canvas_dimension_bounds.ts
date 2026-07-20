//#region What this migration does
// Adds CHECK constraints bounding every stored canvas dimension to
// [16, 512] — the MIN/MAX a room may be resized within (Phase 4). Until now the
// width/height columns were unconstrained INTEGERs that happened to always hold
// the compile-time constant; per-room resize makes them attacker-influenced (the
// resize request carries them), so the database itself should refuse a value
// outside the legal range rather than trusting the application to.
//
// The bounds are HARDCODED here rather than imported from
// shared/constants/canvas. A migration is a frozen historical fact: if it read
// the live constant and that constant later changed, this migration would
// retroactively mean something different. Changing the allowed range means
// writing a NEW migration that ALTERs these constraints — never editing this one.
// The literals MUST stay in step with MIN_CANVAS_DIMENSION (16) and
// MAX_CANVAS_DIMENSION (512).
//
// Existing rows (rooms created before this, at the old 120 default) sit inside
// the range, so the constraint is satisfied without any data migration.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
export async function up(db: Kysely<unknown>): Promise<void> {
  for (const table of ["rooms", "canvas_snapshots", "checkpoints"]) {
    await sql`
      ALTER TABLE ${sql.raw(table)}
      ADD CONSTRAINT ${sql.raw(`${table}_dimension_bounds`)}
      CHECK (
        width  >= 16 AND width  <= 512 AND
        height >= 16 AND height <= 512
      );
    `.execute(db)
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ["rooms", "canvas_snapshots", "checkpoints"]) {
    await sql`
      ALTER TABLE ${sql.raw(table)}
      DROP CONSTRAINT ${sql.raw(`${table}_dimension_bounds`)};
    `.execute(db)
  }
}
//#endregion
