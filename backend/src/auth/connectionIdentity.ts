//#region Imports
import { randomUUID } from "node:crypto"

import type { IncomingMessage } from "node:http"

import { SESSION_COOKIE, parseCookies } from "./cookies"
import { randomGuestName, randomIdentityColor } from "./identity"
import { resolveSessionUser } from "./session"

import type { Participant } from "@shared/types/identity"
//#endregion

//#region Type Defs
// The identity is what's broadcast (no account id); userId is kept server-side
// on the socket to resolve room membership/role. Splitting them here is what
// keeps the account id off the wire (see the note on Participant).
export type ResolvedConnection = {
  identity: Participant
  userId: string | null
}
//#endregion

//#region Connection identity
// Works out who is behind a WebSocket connection at handshake time. The session
// cookie is sent on the upgrade request (same-origin), so a logged-in user is
// recognised here and draws under their account name and colour. Everyone else
// is a guest with a freshly generated name and colour — anonymous drawing still
// works, it just isn't tied to an account.
//
// The `role` here is PROVISIONAL: the real role needs the room to exist and a
// membership lookup, which happens in RoomManager.addClient. A guest is always
// "guest"; a registered user is seeded as "editor" and corrected once membership
// is resolved.
//
// Every connection gets a fresh connectionId regardless: it identifies this one
// socket for presence and cursors, so the same account open in two tabs shows
// as two participants (which is correct — there are two cursors).
export async function resolveConnectionIdentity(
  request: IncomingMessage,
): Promise<ResolvedConnection> {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE]
  const user = await resolveSessionUser(token)
  const connectionId = randomUUID()

  if (user) {
    return {
      identity: {
        connectionId,
        name: user.username,
        color: user.color,
        isGuest: false,
        role: "editor",
      },
      userId: user.id,
    }
  }

  return {
    identity: {
      connectionId,
      name: randomGuestName(),
      color: randomIdentityColor(),
      isGuest: true,
      role: "guest",
    },
    userId: null,
  }
}
//#endregion
