//#region Identity types
// Shared between frontend and backend so the /api/auth response shape and the
// presence roster can't drift apart.

// A user's stored role in a room. Ordered by authority: owner > editor > viewer.
//
// Declared as a const array with the union DERIVED from it, rather than the
// other way round, because both sides need the list at RUNTIME: the backend
// validates an incoming role against it, and the client renders it as a role
// dropdown. Both had grown their own copy of the same three strings. Deriving
// the type from the array means the list and the union can never drift — add a
// role here and every exhaustive switch over RoomRole stops compiling until it
// handles the new case.
export const ROLES = ["owner", "editor", "viewer"] as const
export type RoomRole = (typeof ROLES)[number]

// A connection's effective role. Guests aren't members, so they get "guest" —
// which the authorisation helpers treat as "can draw in an open room, but has no
// edit AUTHORITY" (no checkpoints, no member management). Kept distinct from the
// stored RoomRole so the two can't be confused.
export type ConnectionRole = RoomRole | "guest"

// A registered account, as exposed to the client. Deliberately carries neither
// a password field nor an EMAIL: the backend selects only these columns (see
// userRepository), and the address is stored encrypted at rest and never sent
// back. The client only ever submits an email on the login/register forms;
// nothing renders it, so returning it would be pure exposure with no use.
export type AuthUser = {
  id: string
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

// May this connection draw?
//
// This is the one authorisation rule that depends on ROOM STATE as well as
// role, which is why it takes a second argument. Owners and editors always may;
// everyone below them (viewers and guests alike) may only while the room is in
// open-editing mode.
//
// Guests and viewers are treated identically here on purpose. The alternative —
// letting anonymous guests draw while a signed-in reader could not — reads as a
// bug to anyone who hits it, because signing in would visibly REDUCE what you
// can do. The distinction between the two is elsewhere: a viewer is a member, so
// they can be promoted and can request promotion; a guest is nobody yet.
//
// Passing openEditing explicitly rather than defaulting it is deliberate. A
// default would let a call site silently omit the room state and get a
// permissive answer, which is exactly the mistake that must not compile.
export function canDraw(role: ConnectionRole, openEditing: boolean): boolean {
  if (role === "owner" || role === "editor") {
    return true
  }
  return openEditing
}

// Does this role have EDIT AUTHORITY — the bar for making/restoring checkpoints
// and other member-only actions? Owners and editors only; guests and viewers
// are excluded. This is what the time-travel checkpoints gate on, on both sides:
// RoomManager rejects create/restore/delete without it, and CheckpointsPopup
// hides those controls with the same call.
export function hasEditAuthority(role: ConnectionRole): boolean {
  return role === "owner" || role === "editor"
}

// Can this role manage the room — clear the canvas, assign roles, toggle open
// editing, resize? Owner only. There is exactly one owner per room (enforced by
// a partial unique index), so this is also "is this THE owner".
export function canManageRoom(role: ConnectionRole): boolean {
  return role === "owner"
}

// May this connection ask the owner for editor access? Only a signed-in member
// who is currently a viewer: an owner or editor has nothing to ask for, and a
// guest has no account to promote.
export function canRequestEditor(role: ConnectionRole): boolean {
  return role === "viewer"
}
//#endregion
