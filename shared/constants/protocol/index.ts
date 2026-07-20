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
export { MAX_ROOM_ID_LENGTH, MAX_ID_LENGTH, MAX_CHECKPOINT_NAME_LENGTH }
//#endregion
