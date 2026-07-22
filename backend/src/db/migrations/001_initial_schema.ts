//#region What this migration does
// Creates the ENTIRE schema in one step.
//
// This is a re-squash. The previous history was 001_initial_schema (itself a
// squash of seven incremental migrations) plus three follow-ups —
// 002_email_at_rest, 003_room_open_editing, 004_canvas_dimension_bounds. They
// have now been folded back into this single baseline, so the end state is
// identical but there is one migration again instead of four. The project has no
// deployed database whose data needed carrying forward, which is what makes a
// re-squash safe.
//
// One concrete benefit of folding 002 in: this baseline no longer imports live
// application crypto. Email-at-rest was originally a follow-up that had to READ
// each existing plaintext address, index and encrypt it, then drop the column —
// so it imported auth/emailCrypto to backfill. A fresh database has no rows to
// backfill, so email_index/email_ciphertext are just columns here: pure DDL, no
// coupling to live code, no "a migration that changes when the app changes" wart.
//
// IMPORTANT if you ever deploy this: squashing is only safe while no database has
// the old migration names recorded in `kysely_migration`. Kysely refuses to run
// when a previously-applied migration has vanished, so a database created before
// this squash must be recreated (`docker compose ... down -v`), not upgraded.
//
// From here on the normal rule applies again: NEVER edit this file once it has
// run somewhere. Add a new 002_*.ts instead.
//#endregion

//#region Imports
import { sql, type Kysely } from "kysely"
//#endregion

//#region Migration
// Migrations are typed against `unknown`: they run across the schema's whole
// history, so pinning them to today's Database interface would break the moment
// that interface moves on. Raw SQL via the `sql` tag keeps the DDL explicit and
// reviewable — the query builder is for application queries, not schema.
//
// Creation order follows the foreign keys: rooms and users are referenced by
// everything else, so they come first.
export async function up(db: Kysely<unknown>): Promise<void> {
  // --- Rooms -----------------------------------------------------------------
  // A room's identity and metadata, deliberately separate from its pixel data.
  // `revision` is the room's head — the count of applied instructions — kept in
  // step with the in-memory RoomState. `title` is provisioned but not yet
  // written by any code path (the read path already selects it), so adding a
  // "name your room" feature is a UI change rather than a migration.
  //
  // `open_editing` (folded in from the old 003) is the room-level switch for
  // whether people WITHOUT edit authority may draw — anonymous guests AND
  // logged-in viewers alike, which is why it is "open_editing" not
  // "guest_editing". DEFAULT TRUE deliberately: the whole premise is that you can
  // open a link and immediately draw with people, so locking is the deliberate
  // act, not the default.
  //
  // The `rooms_dimension_bounds` CHECK (folded in from the old 004) bounds the
  // stored size to [16, 512], the MIN/MAX a room may be resized within (Phase 4).
  // Per-room resize makes width/height attacker-influenced (the resize request
  // carries them), so the database itself refuses an out-of-range value rather
  // than trusting the app. The literals are hardcoded on purpose — a migration is
  // a frozen fact — and MUST stay in step with MIN_CANVAS_DIMENSION (16) and
  // MAX_CANVAS_DIMENSION (512) in shared/constants/canvas. Changing the range
  // means a NEW migration that ALTERs the constraint, never editing this one.
  await sql`
    CREATE TABLE rooms (
      id           TEXT PRIMARY KEY,
      title        TEXT,
      width        INTEGER NOT NULL,
      height       INTEGER NOT NULL,
      revision     INTEGER NOT NULL DEFAULT 0,
      open_editing BOOLEAN NOT NULL DEFAULT TRUE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT rooms_dimension_bounds CHECK (
        width  >= 1 AND width  <= 512 AND
        height >= 1 AND height <= 512
      )
    );
  `.execute(db)

  // --- Canvas snapshots ------------------------------------------------------
  // The rolling pixel checkpoint, kept purely as a recovery shortcut so replay
  // doesn't have to start from revision 0. ON DELETE CASCADE ties a snapshot's
  // lifetime to its room — integrity a single-table design cannot express. The
  // dimension CHECK matches rooms: a stored snapshot can't be off-range either.
  await sql`
    CREATE TABLE canvas_snapshots (
      room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      revision   INTEGER NOT NULL,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      rgba       BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, revision),
      CONSTRAINT canvas_snapshots_dimension_bounds CHECK (
        width  >= 1 AND width  <= 512 AND
        height >= 1 AND height <= 512
      )
    );
  `.execute(db)

  // --- Draw events -----------------------------------------------------------
  // The append-only log; the durability backbone. Recovery is "latest snapshot,
  // then replay every event with a higher revision", which shrinks worst-case
  // loss from the 15s snapshot interval to a sub-second flush window.
  //
  //   - `instruction` is JSONB, not pixels. A bucket fill that paints thousands
  //     of pixels is still ONE small row (the instruction, not its result), so
  //     the log stays compact as the canvas fills.
  //   - PRIMARY KEY (room_id, revision) doubles as the ordering key AND makes
  //     re-appending idempotent (ON CONFLICT DO NOTHING), so a failed flush is
  //     safe to retry.
  //   - That same primary-key index already serves the recovery range scan
  //     ("events for this room with revision > N, in order"), so no extra index
  //     is needed here — noted so nobody adds a redundant one.
  await sql`
    CREATE TABLE draw_events (
      room_id     TEXT    NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      revision    INTEGER NOT NULL,
      instruction JSONB   NOT NULL,
      session_id  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, revision)
    );
  `.execute(db)

  // --- Users -----------------------------------------------------------------
  // Email is stored at rest, never in plaintext (folded in from the old 002):
  //
  //   email_index      — a slow-KDF (scrypt) blind index, UNIQUE, used for login
  //                      lookup. Deterministic, so "same address" still means
  //                      "same row" and uniqueness survives the encryption.
  //   email_ciphertext — AES-256-GCM, bound to the row via AAD = user id.
  //
  // A read-only dump therefore contains no readable addresses; recovering one
  // needs a secret deliberately kept out of the database (see auth/emailCrypto).
  // The id must exist before the ciphertext is built (it is the AAD), so the app
  // supplies it (newUserId) rather than relying on the column default — the
  // default is a harmless fallback. gen_random_uuid() is core in Postgres 13+, so
  // no pgcrypto extension is needed. `password_hash` is a self-describing scrypt
  // string — never the password.
  await sql`
    CREATE TABLE users (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email_index      TEXT NOT NULL,
      email_ciphertext TEXT NOT NULL,
      username         TEXT NOT NULL,
      password_hash    TEXT NOT NULL,
      color            TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.execute(db)

  // The uniqueness the old plaintext `email UNIQUE` column used to enforce, now
  // carried by the deterministic blind index.
  await sql`
    CREATE UNIQUE INDEX users_email_index_key ON users (email_index);
  `.execute(db)

  // --- Sessions --------------------------------------------------------------
  // Server-side session store. `id` is the SHA-256 HASH of the cookie token,
  // not the token itself: the raw token lives only in the user's cookie, so a
  // leak of this table hands an attacker hashes they cannot replay as logins.
  // Same reasoning as never storing raw passwords.
  await sql`
    CREATE TABLE sessions (
      id         TEXT PRIMARY KEY,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `.execute(db)

  // Expired-session sweeps filter on expires_at; index it so that stays cheap.
  await sql`
    CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
  `.execute(db)

  // --- Saved colours ---------------------------------------------------------
  // A per-account palette, one row per swatch, stored as canonical "#rrggbbaa".
  // PRIMARY KEY (user_id, color) deduplicates, so saving the same colour twice
  // is a no-op. Guests keep their palette in localStorage instead.
  await sql`
    CREATE TABLE saved_colors (
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      color      TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, color)
    );
  `.execute(db)

  // The palette is always listed oldest-first for one user, so index that.
  await sql`
    CREATE INDEX saved_colors_user_created_idx
      ON saved_colors (user_id, created_at);
  `.execute(db)

  // --- Room members ----------------------------------------------------------
  // The users <-> rooms many-to-many that turns "accounts exist" into "accounts
  // mean something". owner manages members; editor draws and manages
  // checkpoints; viewer is read-only.
  await sql`
    CREATE TABLE room_members (
      room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    );
  `.execute(db)

  // "My rooms" (the dashboard) queries by user_id; the primary key leads with
  // room_id, so this index serves the other direction.
  await sql`
    CREATE INDEX room_members_user_idx ON room_members (user_id);
  `.execute(db)

  // AT MOST ONE owner per room, enforced by the database rather than by
  // application logic. The WHERE clause makes it a PARTIAL index, so it
  // constrains only owner rows and lets any number of editors/viewers coexist.
  //
  // This is what makes claiming ownership race-safe: two users claiming a
  // brand-new room simultaneously cannot both become owner — the loser's INSERT
  // violates this index and the app catches 23505 and falls back to viewer. It is
  // also why setRole transfers ownership inside one transaction (demote, then
  // promote) rather than promoting first.
  await sql`
    CREATE UNIQUE INDEX room_one_owner ON room_members (room_id)
    WHERE role = 'owner';
  `.execute(db)

  // --- Checkpoints -----------------------------------------------------------
  // Named, durable canvas versions. Unlike canvas_snapshots (rolling, latest
  // only, a recovery shortcut), a checkpoint is deliberately saved by an editor
  // and survives until someone deletes it. They do double duty:
  //   1. Restore points — jump the live canvas back to a saved version.
  //   2. Keyframes for playback — compaction keeps the draw_events newer than
  //      the OLDEST checkpoint, so history stays replayable forward from any
  //      checkpoint. That reconciles "bounded storage" with "watch it be drawn".
  //
  // created_by is ON DELETE SET NULL, NOT cascade: deleting a user must not
  // delete the checkpoints they made in a shared room — the version history
  // belongs to the room, not to the person who happened to press save. The
  // dimension CHECK matches rooms/snapshots.
  await sql`
    CREATE TABLE checkpoints (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      revision   INTEGER NOT NULL,
      width      INTEGER NOT NULL,
      height     INTEGER NOT NULL,
      rgba       BYTEA NOT NULL,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT checkpoints_dimension_bounds CHECK (
        width  >= 1 AND width  <= 512 AND
        height >= 1 AND height <= 512
      )
    );
  `.execute(db)

  // Serves the common query: listing a room's checkpoints newest-first.
  //
  // It does NOT serve the compaction floor lookup, which orders by `revision`
  // and therefore sorts. That is deliberate and cheap: checkpoints per room are
  // hard-capped (see checkpointRepository), so that sort is over a handful of
  // rows. The two orderings agree anyway — a checkpoint captures the current,
  // monotonically increasing revision at an increasing wall-clock time, so
  // oldest-by-revision and oldest-by-created_at are always the same row.
  await sql`
    CREATE INDEX checkpoints_room_idx ON checkpoints (room_id, created_at);
  `.execute(db)
}

// Reverse dependency order: anything holding a foreign key goes before the
// table it points at. Pure DDL — dropping the tables drops their indexes and
// constraints with them, and there is no plaintext-email column to reconstruct
// (email-at-rest is part of the baseline now, not a reversible follow-up).
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS checkpoints;`.execute(db)
  await sql`DROP TABLE IF EXISTS room_members;`.execute(db)
  await sql`DROP TABLE IF EXISTS saved_colors;`.execute(db)
  await sql`DROP TABLE IF EXISTS sessions;`.execute(db)
  await sql`DROP TABLE IF EXISTS users;`.execute(db)
  await sql`DROP TABLE IF EXISTS draw_events;`.execute(db)
  await sql`DROP TABLE IF EXISTS canvas_snapshots;`.execute(db)
  await sql`DROP TABLE IF EXISTS rooms;`.execute(db)
}
//#endregion
