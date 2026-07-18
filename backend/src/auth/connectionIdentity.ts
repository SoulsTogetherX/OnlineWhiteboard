//#region Imports
import { randomUUID } from "node:crypto"

import type { IncomingMessage } from "node:http"

import { SESSION_COOKIE, parseCookies } from "./cookies"
import { randomGuestName, randomIdentityColor } from "./identity"
import { resolveSessionUser } from "./session"

import type { Participant } from "@shared/types/identity"
//#endregion

//#region Connection identity
// Works out who is behind a WebSocket connection at handshake time. The session
// cookie is sent on the upgrade request (same-origin), so a logged-in user is
// recognised here and draws under their account name and colour. Everyone else
// is a guest with a freshly generated name and colour — anonymous drawing still
// works, it just isn't tied to an account.
//
// Every connection gets a fresh connectionId regardless: it identifies this one
// socket for presence and cursors, so the same account open in two tabs shows
// as two participants (which is correct — there are two cursors).
export async function resolveConnectionIdentity(
  request: IncomingMessage,
): Promise<Participant> {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE]
  const user = await resolveSessionUser(token)
  const connectionId = randomUUID()

  if (user) {
    return {
      connectionId,
      name: user.username,
      color: user.color,
      isGuest: false,
    }
  }

  return {
    connectionId,
    name: randomGuestName(),
    color: randomIdentityColor(),
    isGuest: true,
  }
}
//#endregion
