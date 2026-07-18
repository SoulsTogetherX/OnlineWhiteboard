//#region Identity types
// Shared between frontend and backend so the /api/auth response shape and the
// presence roster can't drift apart.

// A user's stored role in a room. Ordered by authority: owner > editor > viewer.
export type RoomRole = "owner" | "editor" | "viewer"

// A connection's effective role. Guests aren't members, so they get "guest" —
// which the authorisation helpers treat as "can draw in an open room, but has no
// edit AUTHORITY" (no checkpoints, no member management). Kept distinct from the
// stored RoomRole so the two can't be confused.
export type ConnectionRole = RoomRole | "guest"

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
  // The connection's role in THIS room. Safe to broadcast (it's about the room,
  // not a cross-room identifier) and lets the roster show an owner crown / a
  // "view only" badge.
  role: ConnectionRole
}

// Central authorisation helpers, shared so the client can grey out controls with
// the SAME rule the server enforces (the server is still the source of truth —
// the client checks are cosmetic).

// Can this role draw / take part in destructive-action votes? Everyone except a
// viewer.
export function canDraw(role: ConnectionRole): boolean {
  return role !== "viewer"
}

// Does this role have EDIT AUTHORITY — the bar for making/restoring checkpoints
// and other member-only actions? Owners and editors only; guests and viewers
// are excluded. This is the helper the time-travel checkpoints will gate on.
export function hasEditAuthority(role: ConnectionRole): boolean {
  return role === "owner" || role === "editor"
}

// Can this role manage the room (change members' roles)? Owner only.
export function canManageRoom(role: ConnectionRole): boolean {
  return role === "owner"
}
//#endregion
