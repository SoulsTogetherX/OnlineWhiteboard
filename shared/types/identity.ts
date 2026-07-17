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
// two participants); userId is null for guests.
export type Participant = {
  connectionId: string
  userId: string | null
  name: string
  color: string
  isGuest: boolean
}
//#endregion
