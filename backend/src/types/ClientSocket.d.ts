//#region Imports
import WebSocket from "ws"

import type { Participant } from "@shared/types/identity"
//#endregion

//#region Type Defs
export interface ClientSocket extends WebSocket {
  isAlive: boolean
  roomId: string
  // Assigned once at connection time (see resolveConnectionIdentity): who this
  // socket is in the room. `connectionId` is unique per socket — the same
  // account in two tabs is two participants — and doubles as the key for the
  // presence roster and live cursors.
  connectionId: string
  identity: Participant
  // The logged-in account id, or null for a guest. Server-side only — kept off
  // the broadcast Participant on purpose (see the note there). Used to resolve
  // this connection's room role and membership.
  userId: string | null
  // The SHA-256 of this connection's session cookie, or null for a guest. Keyed
  // on rather than the raw token so a heap dump is not a set of live
  // credentials. Lets logout disconnect exactly this person's sockets, and lets
  // the periodic sweep re-check the session that authorised them.
  sessionHash: string | null
}
//#endregion
