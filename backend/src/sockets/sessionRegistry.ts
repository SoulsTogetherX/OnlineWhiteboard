//#region Why this exists
// A WebSocket is authenticated ONCE, at the upgrade, and then lives for as long
// as the browser tab does. That produces two gaps that HTTP does not have,
// because HTTP re-presents its cookie on every single request:
//
//   1. LOGOUT DID NOT DISCONNECT. Logging out deletes the session row, so every
//      later HTTP request is anonymous — but an already-open socket kept acting
//      under the old identity indefinitely. "Log out" on a shared computer did
//      not actually end access in the tab still holding a socket.
//
//   2. EXPIRY DID NOT DISCONNECT. A 30-day session that lapses mid-connection
//      left the socket authenticated past its own expiry.
//
// OWASP's WebSocket guidance calls for both: terminate connections on logout,
// and re-validate long-lived sessions periodically. This module owns the
// socket<->session mapping needed to do either.
//
// Sockets are keyed by the session token's HASH, never the token: the registry
// is a long-lived in-memory structure, and filling it with live credentials
// would turn a heap dump into a session-hijacking kit. The hash is also exactly
// what the database stores, so revalidation is a direct lookup.
//#endregion

//#region Imports
import { findUserBySessionHash } from "@/db/sessionRepository"

import type { ClientSocket } from "@/types/ClientSocket"
//#endregion

//#region Constants
// How often live sessions are re-checked against the database. OWASP suggests
// ~30 minutes for periodic re-validation. Logout is handled immediately and
// separately, so this only has to catch EXPIRY and out-of-band revocation —
// neither of which is urgent to the minute, and each sweep costs one query per
// distinct logged-in session.
const REVALIDATE_INTERVAL_MS = 30 * 60 * 1000

// 1008 = policy violation. The client's reconnect logic then re-handshakes with
// whatever cookie it now has, so a still-valid user reconnects seamlessly and a
// logged-out one comes back as a guest — which is the correct outcome.
const CLOSE_SESSION_ENDED = 1008
//#endregion

//#region Registry
// sessionHash -> the live sockets authenticated by it. One person with three
// tabs is three sockets under one hash, and all three must drop together on
// logout.
const sockets = new Map<string, Set<ClientSocket>>()

export function registerSocket(sessionHash: string, socket: ClientSocket): void {
  let set = sockets.get(sessionHash)
  if (!set) {
    set = new Set<ClientSocket>()
    sockets.set(sessionHash, set)
  }
  set.add(socket)
}

export function unregisterSocket(
  sessionHash: string,
  socket: ClientSocket,
): void {
  const set = sockets.get(sessionHash)
  if (!set) {
    return
  }
  set.delete(socket)
  // Drop the key at zero so the map tracks live sessions rather than growing
  // forever with the hash of every session that has ever connected.
  if (set.size === 0) {
    sockets.delete(sessionHash)
  }
}

// Closes every socket authenticated by this session. Called by logout, so the
// disconnect is immediate rather than waiting up to REVALIDATE_INTERVAL_MS.
// Returns how many were closed, for logging and tests.
export function closeSocketsForSession(sessionHash: string): number {
  const set = sockets.get(sessionHash)
  if (!set) {
    return 0
  }
  const closed = set.size
  for (const socket of set) {
    socket.close(CLOSE_SESSION_ENDED, "Session ended")
  }
  // The close handler unregisters each socket; clear now so a slow close cannot
  // leave a stale entry that a later logout would try to close twice.
  sockets.delete(sessionHash)
  return closed
}

// Closes every socket belonging to a USER, across all of their sessions.
//
// Deleting an account only closed the sockets of the session that made the
// request. The other sessions' rows cascade away with the user, but their
// sockets stayed open — each holding a `userId` for a row that no longer exists
// — until the next revalidation sweep, up to 30 minutes later. The delete route
// closes sockets first precisely so nothing keeps acting as a deleted user, and
// that guarantee only held for one session out of however many.
//
// This scans rather than keeping a second index: it runs on account deletion and
// (in future) password change, both rare, and a parallel index is one more thing
// that can fall out of step with this one.
export function closeSocketsForUser(userId: string): number {
  let closed = 0
  for (const [hash, set] of sockets) {
    for (const socket of set) {
      if (socket.userId === userId) {
        socket.close(CLOSE_SESSION_ENDED, "Account closed")
        set.delete(socket)
        closed += 1
      }
    }
    if (set.size === 0) {
      sockets.delete(hash)
    }
  }
  return closed
}

// Test/observability helper.
export function socketCountForSession(sessionHash: string): number {
  return sockets.get(sessionHash)?.size ?? 0
}
//#endregion

//#region Revalidation sweep
let sweepTimer: NodeJS.Timeout | undefined

// Re-checks every live session against the database and disconnects any that no
// longer resolve — expired, or revoked somewhere this process never saw.
export async function revalidateSessions(): Promise<number> {
  let closed = 0
  // Snapshot the keys first: closing a socket mutates the map as we iterate.
  for (const sessionHash of [...sockets.keys()]) {
    try {
      const user = await findUserBySessionHash(sessionHash)
      if (!user) {
        closed += closeSocketsForSession(sessionHash)
      }
    } catch (error) {
      // A database blip must not disconnect legitimate users — leave them and
      // retry on the next sweep. Failing OPEN is right here: the cost of a
      // missed revalidation is bounded by the next sweep, while the cost of
      // failing closed is kicking everyone off during a transient outage.
      console.error("Session revalidation failed:", error)
    }
  }
  if (closed > 0) {
    console.log(`revalidation: closed ${closed} socket(s) with dead sessions`)
  }
  return closed
}

export function startSessionRevalidation(): void {
  sweepTimer = setInterval(() => void revalidateSessions(), REVALIDATE_INTERVAL_MS)
  // Never keep the process alive on this timer alone.
  sweepTimer.unref?.()
}

export function stopSessionRevalidation(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = undefined
  }
}
//#endregion
