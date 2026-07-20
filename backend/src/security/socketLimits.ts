//#region Why this exists
// Validation bounds what ONE message can do. Nothing bounded how many a client
// could send, so a well-formed flood was still a denial of service: the guards
// would dutifully accept every message and the server would dutifully apply it.
//
// Two independent limits live here, because they stop different attacks:
//
//   1. A per-socket token bucket — one connection cannot monopolise the server.
//   2. A per-identity connection cap — one actor cannot dodge (1) by opening a
//      thousand sockets, which would otherwise make the per-socket limit
//      pointless.
//
// Both are in-memory and therefore per-process, exactly like the room map and
// the HTTP rate limiter. Multiple backend instances would need a shared store
// (Redis). That is a known, documented limit of this architecture, not an
// oversight.
//#endregion

//#region Imports
import type { IncomingMessage } from "node:http"

import { SESSION_COOKIE, parseCookies } from "@/auth/cookies"
import { hashSessionToken } from "@/auth/session"

import type { ClientSocketMessage } from "@shared/types/socketProtocol"
//#endregion

//#region Rate limit tuning
// These numbers are derived from what the CLIENT actually emits, not picked off
// a blog post. OWASP suggests ~100 messages/minute as a starting baseline; that
// is right for a chat-shaped protocol and catastrophically wrong here, because a
// single stroke emits one draw per pointermove.
//
//   - draw:   driven by pointermove, so bounded by display refresh. 60Hz gives
//             ~60/s, a 120Hz screen ~120/s, and coalescing can spike higher.
//   - cursor: throttled client-side to one per 45ms (~22/s).
//   - ping:   one per heartbeat interval, negligible.
//
// Realistic peak is therefore ~150 messages/second from a legitimate client
// drawing as fast as the hardware allows. The sustained rate is set at that
// peak, and the bucket holds several seconds of it so a burst never trips on
// someone simply scribbling quickly.
const SUSTAINED_UNITS_PER_SEC = 200
const BURST_CAPACITY = 600

// Dropping a message is cheap and invisible; closing a connection is not. So a
// client that briefly exceeds the bucket just loses those messages, and only a
// client that keeps hammering after being throttled gets disconnected. This is
// what stops a laggy-but-honest client being punished like a hostile one.
const MAX_VIOLATIONS_BEFORE_CLOSE = 120
//#endregion

//#region Message cost
// A flat per-message cost would miss the real hazard: messages are not equally
// expensive. A pencil stroke touches a handful of pixels; a bucket fill floods
// up to the whole canvas; a checkpoint or playback request hits Postgres. A
// client sending 150 bucket fills a second is within any count-based limit and
// still pins a CPU.
//
// So cost approximates SERVER WORK, not bytes.
export function messageCost(message: ClientSocketMessage): number {
  switch (message.type) {
    // Free: answering a ping is what proves the server is alive, and rate
    // limiting the liveness check would be self-defeating.
    case "ping":
      return 0

    case "cursor":
      return 1

    case "draw":
      switch (message.instruction.type) {
        // Flood fill is unbounded-ish work: it can repaint the entire canvas
        // from one message.
        case "bucket":
          return 10
        // Spray scatters up to MAX_SPRAY_DENSITY pixels per puff.
        case "spray":
          return 3
        // A patch is proportional to its entry count, which validation has
        // already bounded to the pixel count.
        case "patch":
          return 1 + Math.floor(message.instruction.entries.length / 500)
        // clear is rejected from clients anyway, but cost it as expensive so a
        // flood of rejected clears still burns budget.
        case "clear":
          return 10
        default:
          return 1
      }

    // A full-canvas snapshot re-encode and send.
    case "resync":
      return 25

    // These all hit the database.
    case "create_checkpoint":
    case "restore_checkpoint":
    case "delete_checkpoint":
      return 50
    case "request_playback":
      return 50

    // Owner-only and destructive: a clear repaints the entire buffer and is
    // logged and broadcast like any other instruction.
    case "room_action":
      return 10

    // Permission changes all write to Postgres, and several of them re-resolve
    // every member's role afterwards.
    case "claim_ownership":
    case "release_ownership":
    case "set_open_editing":
    case "respond_editor":
    case "set_member_role":
      return 20

    // In-memory only, but still metered so the owner cannot be spammed with
    // request notifications.
    case "request_editor":
      return 5

    default:
      return 1
  }
}

// A message that fails validation is charged MORE than a valid one, for two
// reasons: garbage is a stronger signal of a hostile client than legitimate
// traffic is, and every invalid message triggers an error reply — so an
// unmetered flood of junk would be an amplification vector, making the server
// send one message for every message it receives.
export const INVALID_MESSAGE_COST = 5
//#endregion

//#region Token bucket
type Bucket = {
  tokens: number
  lastRefillMs: number
  violations: number
}

export type LimitDecision = "allow" | "drop" | "close"

// Classic token bucket: tokens refill continuously at a fixed rate up to a
// ceiling, and each message spends some. Chosen over a fixed window because a
// fixed window lets a client send its entire allowance in the last millisecond
// of one window and again in the first of the next — a 2x burst at the seam.
// A bucket smooths that out by construction.
export class SocketRateLimiter {
  // Keyed by the socket object itself, so an entry disappears when the socket is
  // garbage collected. No cleanup timer, no leak if a disconnect is missed.
  private buckets = new WeakMap<object, Bucket>()

  constructor(
    private readonly capacity: number = BURST_CAPACITY,
    private readonly refillPerSec: number = SUSTAINED_UNITS_PER_SEC,
    private readonly maxViolations: number = MAX_VIOLATIONS_BEFORE_CLOSE,
  ) {}

  // now is injectable so tests can drive time deterministically instead of
  // sleeping — a rate limiter tested with real sleeps is a slow, flaky test.
  consume(socket: object, cost: number, now: number = Date.now()): LimitDecision {
    let bucket = this.buckets.get(socket)
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now, violations: 0 }
      this.buckets.set(socket, bucket)
    }

    // Refill for the time that has passed, capped at the ceiling.
    const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000)
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsedSec * this.refillPerSec,
    )
    bucket.lastRefillMs = now

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost
      // Sustained good behaviour forgives past violations, so a client that
      // spiked once and then behaved is not disconnected minutes later.
      if (bucket.violations > 0) {
        bucket.violations -= 1
      }
      return "allow"
    }

    bucket.violations += 1
    return bucket.violations >= this.maxViolations ? "close" : "drop"
  }
}
//#endregion

//#region Connection cap
// Without this, the per-socket bucket is trivially bypassed: open N sockets, get
// N times the allowance.
//
// Authenticated users are capped tightly because the key identifies one PERSON,
// and several tabs is the only legitimate reason to need more than a couple.
// Guests are keyed by IP, which is far blunter — an office, a school or a mobile
// carrier NAT can put many genuine users behind one address — so that cap is
// deliberately much looser. Getting this backwards would lock out a whole
// building to stop one abuser.
const MAX_CONNECTIONS_PER_USER = 8
const MAX_CONNECTIONS_PER_IP = 32

export class ConnectionCounter {
  private counts = new Map<string, number>()

  // Returns false when the cap is already reached, in which case the caller must
  // NOT call release() — nothing was acquired.
  tryAcquire(key: string, isAuthenticated: boolean): boolean {
    const limit = isAuthenticated
      ? MAX_CONNECTIONS_PER_USER
      : MAX_CONNECTIONS_PER_IP
    const current = this.counts.get(key) ?? 0
    if (current >= limit) {
      return false
    }
    this.counts.set(key, current + 1)
    return true
  }

  release(key: string): void {
    const current = this.counts.get(key)
    if (current === undefined) {
      return
    }
    // Delete at zero rather than storing a 0, so the map tracks live
    // connections and cannot grow forever with idle keys.
    if (current <= 1) {
      this.counts.delete(key)
      return
    }
    this.counts.set(key, current - 1)
  }

  // Test/observability helper.
  count(key: string): number {
    return this.counts.get(key) ?? 0
  }
}

// The key a connection is counted against, derived WITHOUT touching the
// database. That matters: the cap exists to stop a socket flood, so it has to be
// enforceable before we do any per-connection work, or enforcing it becomes the
// very thing being abused.
//
// A logged-in visitor is identified by the hash of their session cookie. That is
// effectively per-user (OWASP's preference over per-IP) and costs one hash, no
// query. The raw token is never used as a map key — hashing it means the live
// key set isn't a pile of usable session tokens sitting in memory.
//
// Everyone else falls back to IP, which is much blunter, hence the far looser
// limit that pairs with it.
export function connectionKey(request: IncomingMessage): {
  key: string
  isAuthenticated: boolean
} {
  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE]
  if (token) {
    return { key: `s:${hashSessionToken(token)}`, isAuthenticated: true }
  }

  // Same trust reasoning as the HTTP limiter: in production the backend
  // publishes no host port, so X-Real-IP can only come from our own nginx.
  const header = request.headers["x-real-ip"]
  const ip =
    typeof header === "string" && header.length > 0
      ? header
      : (request.socket.remoteAddress ?? "unknown")
  return { key: `ip:${ip}`, isAuthenticated: false }
}
//#endregion

//#region Exports for tests
export {
  SUSTAINED_UNITS_PER_SEC,
  BURST_CAPACITY,
  MAX_VIOLATIONS_BEFORE_CLOSE,
  MAX_CONNECTIONS_PER_USER,
  MAX_CONNECTIONS_PER_IP,
}
//#endregion
