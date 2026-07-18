//#region Identity types
// Shared between frontend and backend so the /api/auth response shape and the
// presence roster can't drift apart.

// A registered account, as exposed to the client. Deliberately has no password
// field — the backend selects only these columns (see userRepository).
export type AuthUser = {
  id: string
  email: string
  username: string
  color: string
  isGuest: false
}

// Everyone in a room has an identity for presence — registered or guest. The
// connectionId identifies a single live socket (a user with two tabs open is
// two participants).
//
// Deliberately NO account id here: this object is broadcast to every other
// person in the room, and exposing a stable per-account identifier would let
// anyone correlate the same user across rooms and sessions — a needless
// deanonymisation vector. Presence needs a display name and a colour, nothing
// that ties back to the account.
export type Participant = {
  connectionId: string
  name: string
  color: string
  isGuest: boolean
}
//#endregion
