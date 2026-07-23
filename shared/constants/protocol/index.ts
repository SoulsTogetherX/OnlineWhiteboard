//#region Why these exist
// Bounds for the string fields carried by the wire protocol. Every one of these
// is an anti-abuse limit first and a UI constraint second — an unbounded string
// from the network becomes an unbounded database row, an unbounded log line, or
// an unbounded thing to render.
//#endregion

//#region Identifiers
// A room id is user-typed and creates a database row on first visit, so it needs
// a ceiling. 64 characters is far more than anyone types deliberately and still
// short enough that a million of them is trivial storage.
const MAX_ROOM_ID_LENGTH = 64

// What a room-name INPUT accepts, which is deliberately stricter than what the
// protocol allows. The two are different jobs: the 64 above is the anti-abuse
// ceiling the server enforces on anything arriving over the wire, while this is
// a usability cap on what someone types — long enough to be descriptive, short
// enough to fit a dashboard card and a sidebar header without truncating.
//
// Shared rather than repeated on each input, because it was previously written
// out at all three call sites (the lobby, the change-room field, and the room
// popup) and that is exactly how three 22s become a 22, a 22 and a 30.
const MAX_ROOM_NAME_INPUT_LENGTH = 30

// Checkpoint and account ids are server-generated UUIDs (36 chars). The cap exists
// so a client can't hand back a megabyte where an id belongs; it is not a format
// check — the lookup itself is what rejects an id that doesn't exist.
const MAX_ID_LENGTH = 64
//#endregion

//#region Names
// Checkpoint display name. Shared so the server's trim and the input's
// maxLength cannot drift apart — they were previously hardcoded separately on
// each side, which is exactly how two "60"s become a 60 and an 80.
const MAX_CHECKPOINT_NAME_LENGTH = 60
//#endregion

//#region Exports
export {
  MAX_ROOM_ID_LENGTH,
  MAX_ROOM_NAME_INPUT_LENGTH,
  MAX_ID_LENGTH,
  MAX_CHECKPOINT_NAME_LENGTH,
}
//#endregion
