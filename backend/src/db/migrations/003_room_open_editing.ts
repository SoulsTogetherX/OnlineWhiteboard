//#region What this migration does
// Adds the room-level switch that decides whether people WITHOUT edit authority
// may draw.
//
// Naming: this is called `open_editing`, not `guest_editing`, because it governs
// everyone below editor — anonymous guests AND logged-in viewers alike. Calling
// it "guest" would have been a lie the first time someone read it, since a
// logged-in reader is not a guest and is equally affected.
//
// DEFAULT TRUE, deliberately. The app's whole premise is that you can open a
// link and immediately draw with people; defaulting to locked would break the
// first-run experience for every room ever created. Locking is the deliberate
// act, not the default.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE rooms
    ADD COLUMN open_editing BOOLEAN NOT NULL DEFAULT TRUE;
  `.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE rooms DROP COLUMN open_editing;`.execute(db)
}
//#endregion
