//#region Why this file exists
// Kysely is a *typed* query builder: it does not read the live database to
// learn its shape (that would need codegen and a running DB at build time).
// Instead you hand it this interface, and it type-checks every query against
// it — a wrong column name or a string/number mismatch becomes a compile error.
//
// This interface describes the CURRENT (latest) schema — what the tables look
// like after every migration has run. The migrations in ./migrations describe
// how the database GOT here. The two are halves of one contract that nothing
// enforces automatically: a migration adds a column, you add the field here by
// hand, and if they disagree, queries typecheck against a schema the database
// doesn't have and fail at runtime. Codegen (kysely-codegen) can derive this
// from the DB once the schema stabilises; kept hand-written while it moves.
//#endregion

//#region Imports
import type { ColumnType, Generated } from "kysely"

import type { DrawInstruction } from "@shared/types/drawProtocol"
//#endregion

//#region Column Helpers
// ColumnType<Select, Insert, Update> lets a column present three different
// TypeScript types depending on the operation. A TIMESTAMPTZ with a DB default
// comes back as a Date on SELECT, but must NOT be required on INSERT (the
// default fills it) — so its Insert arm includes `undefined`.
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
//#endregion

//#region Table Rows
// A room's identity and metadata, split apart from its pixel data. `revision`
// is the room's current head — the count of applied instructions — kept in sync
// with the in-memory RoomState.
//
// Ownership/membership attaches via the room_members table, not here. `title` is provisioned but not yet written by any code path: the read
// path (listRoomsForUser) already selects it, so adding a "name your room"
// feature is a UI change rather than a migration. It reads as null today.
export interface RoomsTable {
  id: string
  title: ColumnType<string | null, string | null | undefined, string | null>
  width: number
  height: number
  revision: Generated<number>
  // Whether people without edit authority (guests AND viewers) may draw.
  // Generated because the column has a database default.
  open_editing: Generated<boolean>
  created_at: Timestamp
  updated_at: Timestamp
}

// A checkpoint of the full pixel buffer at a specific revision. In the
// event-sourcing model the source of truth is the draw_events log (Stage 3);
// a snapshot exists only so recovery doesn't have to replay from revision 0.
// One row per room is kept (the latest) — older checkpoints are redundant once
// a newer one exists. The (room_id, revision) key is what lets the event log
// anchor replay to "everything after this snapshot".
export interface CanvasSnapshotsTable {
  room_id: string
  revision: number
  width: number
  height: number
  // pg returns BYTEA as a Node Buffer; on write we hand it a Buffer too.
  rgba: Buffer
  created_at: Timestamp
}

// The append-only event log — one row per applied instruction, the durable
// source of truth between snapshots.
//
// `instruction` is where the three-arm ColumnType earns its keep. node-postgres
// AUTOMATICALLY parses a JSONB column into a JS object on SELECT, but does NOT
// serialise one on INSERT — so the Select arm is the parsed DrawInstruction
// while the Insert/Update arms are `string` (the caller hands over
// JSON.stringify(instruction)). Getting this wrong is a runtime error, not a
// type error, which is exactly why pinning it here matters.
export interface DrawEventsTable {
  room_id: string
  revision: number
  instruction: ColumnType<DrawInstruction, string, string>
  session_id: string | null
  created_at: Timestamp
}

// A registered account. `password_hash` is a self-describing scrypt string
// (never the password); `color` is the identity colour shown in presence.
// `id` is NOT Generated: it is produced by the application (newUserId), not by
// the column default, because it is the AAD binding email_ciphertext to this
// row and therefore has to exist before the row is built.
//
// There is deliberately no plaintext `email`. `email_index` is a slow-KDF blind
// index (deterministic, so it can be looked up and kept UNIQUE) and
// `email_ciphertext` is AES-256-GCM. Neither is readable without a secret that
// lives outside the database. See auth/emailCrypto.ts.
export interface UsersTable {
  id: string
  email_index: string
  email_ciphertext: string
  username: string
  password_hash: string
  color: string
  created_at: Timestamp
}

// Server-side session store. `id` is the SHA-256 hash of the cookie token, not
// the token itself (see 001_initial_schema). A row exists only while a login is
// live.
export interface SessionsTable {
  id: string
  user_id: string
  expires_at: Timestamp
  created_at: Timestamp
}

// One saved palette swatch for one user, as a "#rrggbbaa" string.
export interface SavedColorsTable {
  user_id: string
  color: string
  created_at: Timestamp
}

// A user's role in a room (the users<->rooms many-to-many). `role` is one of
// owner/editor/viewer, constrained in the database by a CHECK constraint, with
// a partial unique index enforcing at most one owner per room.
export interface RoomMembersTable {
  room_id: string
  user_id: string
  role: string
  created_at: Timestamp
  updated_at: Timestamp
}

// A durable, named full-canvas version. rgba is the pixel buffer
// at `revision`. created_by is nullable (ON DELETE SET NULL) — the version
// outlives the user who made it.
export interface CheckpointsTable {
  id: Generated<string>
  room_id: string
  name: string
  revision: number
  width: number
  height: number
  rgba: Buffer
  created_by: string | null
  created_at: Timestamp
}
//#endregion

//#region Database
// The top-level shape Kysely is generic over: property name = table name.
// There is intentionally no `canvases` table: the original single-table design
// was superseded by rooms + canvas_snapshots before the migrations were squashed
// into one baseline, so it never exists on a database built from this schema.
export interface Database {
  rooms: RoomsTable
  canvas_snapshots: CanvasSnapshotsTable
  draw_events: DrawEventsTable
  users: UsersTable
  sessions: SessionsTable
  saved_colors: SavedColorsTable
  room_members: RoomMembersTable
  checkpoints: CheckpointsTable
}
//#endregion
