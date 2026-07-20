/**
 * End-to-end permission probe.
 *
 * Drives the entire ownership/permission model against a live stack with real
 * accounts: nobody is auto-owner, ownership is claimed, locking a room stops
 * everyone below editor from drawing, and an editor request round-trips.
 *
 * Zero dependencies (Node's global fetch + WebSocket), same as smoke-test.mjs.
 *
 *   node scripts/permissions-probe.mjs http://127.0.0.1:8080
 */

const BASE = process.argv[2] ?? "http://127.0.0.1:8080"
const WS_BASE = BASE.replace(/^http/, "ws")
const ROOM = `perm-${Math.floor(Math.random() * 1000000)}`
const PASSWORD = "vh7Qz-Larkspur-Meridian-42x"

let failures = 0
const pass = (m) => console.log(`  ✓ ${m}`)
const fail = (m) => {
  console.log(`  ✗ ${m}`)
  failures += 1
}

async function register(label) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, username: label, password: PASSWORD }),
  })
  if (res.status !== 201) {
    throw new Error(`register(${label}) -> ${res.status}`)
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ")
  const body = await res.json()
  return { cookie, userId: body.user.id }
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?roomId=${ROOM}`, {
      headers: cookie ? { Cookie: cookie } : {},
    })
    const seen = []
    ws.addEventListener("message", (e) => {
      try {
        seen.push(JSON.parse(e.data))
      } catch {
        /* ignore */
      }
    })
    ws.addEventListener("open", () => resolve({ ws, seen }))
    ws.addEventListener("error", () => reject(new Error("socket failed")))
  })
}

function waitFor(seen, predicate, what, ms = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const hit = seen.find(predicate)
      if (hit) {
        resolve(hit)
        return
      }
      if (Date.now() - started > ms) {
        reject(new Error(`timed out waiting for ${what}`))
        return
      }
      setTimeout(tick, 40)
    }
    tick()
  })
}

const stroke = (id) => ({
  type: "draw",
  roomId: ROOM,
  instruction: {
    type: "pencil",
    prevPos: [1, 1],
    nextPos: [4, 4],
    instructionId: id,
    sessionId: "perm-probe",
    color: { r: 10, g: 20, b: 30, a: 255 },
  },
})

console.log(`permissions probe -> ${BASE} (room "${ROOM}")\n`)

const alice = await register("Alice")
const carol = await register("Carol")

// --- 1. Signing in does NOT make you an owner -------------------------------
const a = await connect(alice.cookie)
const aReady = await waitFor(a.seen, (m) => m.type === "ready", "A ready")
aReady.self.role === "viewer"
  ? pass("first signed-in visitor joins as VIEWER, not owner")
  : fail(`expected viewer, got ${aReady.self.role}`)
aReady.hasOwner === false
  ? pass("a fresh room starts with no owner")
  : fail("fresh room already reports an owner")

// --- 2. Open editing lets a viewer draw -------------------------------------
a.ws.send(JSON.stringify(stroke(1)))
await waitFor(a.seen, (m) => m.type === "draw", "A's stroke to apply")
pass("a viewer CAN draw while the room is open")

// --- 3. Ownership is claimed, not granted -----------------------------------
a.ws.send(JSON.stringify({ type: "claim_ownership", roomId: ROOM }))
const promoted = await waitFor(
  a.seen,
  (m) => m.type === "role_changed" && m.self.role === "owner",
  "A to become owner",
)
promoted.self.role === "owner"
  ? pass("claiming an unowned room makes you the owner")
  : fail("claim did not promote")
await waitFor(
  a.seen,
  (m) => m.type === "room_settings" && m.hasOwner === true,
  "hasOwner broadcast",
)
pass("room_settings broadcasts that the room now has an owner")

// --- 4. A second account cannot steal ownership -----------------------------
const c = await connect(carol.cookie)
await waitFor(c.seen, (m) => m.type === "ready", "C ready")
c.ws.send(JSON.stringify({ type: "claim_ownership", roomId: ROOM }))
await waitFor(
  c.seen,
  (m) => m.type === "error" && /already has an owner/i.test(m.message ?? ""),
  "C's claim to be refused",
)
pass("a second account cannot claim an owned room")

// --- 5. Locking the room stops everyone below editor ------------------------
a.ws.send(JSON.stringify({ type: "set_open_editing", roomId: ROOM, enabled: false }))
await waitFor(
  c.seen,
  (m) => m.type === "room_settings" && m.openEditing === false,
  "the lock to broadcast",
)
pass("owner can lock the room, and it broadcasts to everyone")

const cDrawsBefore = c.seen.filter((m) => m.type === "draw").length
c.ws.send(JSON.stringify(stroke(2)))
await waitFor(
  c.seen,
  (m) => m.type === "error" && /permission/i.test(m.message ?? ""),
  "C's draw to be rejected",
)
pass("a viewer CANNOT draw once the room is locked")

await new Promise((r) => setTimeout(r, 400))
c.seen.filter((m) => m.type === "draw").length === cDrawsBefore
  ? pass("the rejected stroke never reached the canvas")
  : fail("a rejected stroke was broadcast anyway")

// --- 6. The owner is never locked out of their own room ---------------------
a.ws.send(JSON.stringify(stroke(3)))
await waitFor(
  a.seen,
  (m) => m.type === "draw" && m.instruction?.instructionId === 3,
  "the owner's stroke",
)
pass("the owner can still draw in a locked room")

// --- 7. Editor request round-trip ------------------------------------------
c.ws.send(JSON.stringify({ type: "request_editor", roomId: ROOM }))
const requests = await waitFor(
  a.seen,
  (m) => m.type === "editor_requests" && m.requests.length > 0,
  "the owner to receive the request",
)
requests.requests[0].userId === carol.userId
  ? pass("owner receives the editor request, naming the requester")
  : fail("editor request had the wrong user")

// It must go ONLY to the owner.
c.seen.some((m) => m.type === "editor_requests")
  ? fail("the requester was sent the owner-only request list")
  : pass("editor requests are sent to the owner ONLY")

a.ws.send(
  JSON.stringify({
    type: "respond_editor",
    roomId: ROOM,
    userId: carol.userId,
    approve: true,
  }),
)
await waitFor(
  c.seen,
  (m) => m.type === "role_changed" && m.self.role === "editor",
  "C to be promoted",
)
pass("approving a request promotes the requester to editor")

// --- 8. An editor can draw even in a locked room ---------------------------
c.ws.send(JSON.stringify(stroke(4)))
await waitFor(
  c.seen,
  (m) => m.type === "draw" && m.instruction?.instructionId === 4,
  "the new editor's stroke",
)
pass("a promoted editor CAN draw in a locked room")

// --- 9. A non-owner cannot manage the room ---------------------------------
c.ws.send(JSON.stringify({ type: "set_open_editing", roomId: ROOM, enabled: true }))
await waitFor(
  c.seen,
  (m) => m.type === "error" && /owner/i.test(m.message ?? ""),
  "the editor's settings change to be refused",
)
pass("an editor cannot change room settings (owner only)")

a.ws.close()
c.ws.close()

console.log(
  `\n${failures === 0 ? "permissions probe PASSED" : `permissions probe FAILED (${failures})`}`,
)
process.exit(failures === 0 ? 0 : 1)
