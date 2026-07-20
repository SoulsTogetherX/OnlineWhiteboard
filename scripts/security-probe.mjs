/**
 * Adversarial security probe — drives the socket trust boundary against a LIVE
 * server and asserts the server survives each abuse.
 *
 * This is the runtime counterpart to the unit tests in
 * shared/utils/__tests__/validateSocketMessage.test.ts. Those prove the guards
 * return false; this proves the RUNNING server applies them — through the real
 * proxy, the real esbuild bundle and a real socket.
 *
 * Like smoke-test.mjs it uses Node's global `WebSocket`, so it has zero
 * dependencies and CI can run it with plain `node` — nothing to install.
 *
 *   node scripts/security-probe.mjs http://localhost:8080     # through nginx
 *   node scripts/security-probe.mjs http://localhost:3000     # direct
 *
 * NOTE on the payload-limit case: `maxPayload` is real and was verified
 * DETERMINISTICALLY by connecting straight to the backend inside its container —
 * an 8 MiB frame against the 256 KiB ceiling closes the socket with 1009 every
 * time. Through the nginx proxy, however, whether that close arrives inside the
 * probe's window varies run to run (it depends on how the 8 MiB send is flushed
 * and buffered). So the 1009 check is INFORMATIONAL here: asserting on it would
 * buy nothing and make CI flaky.
 *
 * The hard assertion is the property that holds regardless of timing or of what
 * sits in front of the app: one abusive client cannot degrade service for
 * anybody else. If you want to watch the 1009 itself, run this directly against
 * the backend rather than through the proxy.
 */

const BASE = process.argv[2] ?? "http://localhost:8080"
const WS_BASE = BASE.replace(/^http/, "ws")
const ROOM = `probe-${Math.floor(Math.random() * 100000)}`

// Mirrors the canvas pixel count — the largest patch that can ever be legitimate.
const MAX_PATCH_ENTRIES = 120 * 120

// Packs a patch draw as the binary frame real clients send. Mirrors
// shared/utils/patchCodec.ts. The oversized-patch check below MUST use this: as
// JSON, MAX_PATCH_ENTRIES+1 entries is ~1.37 MB, which now trips maxPayload
// (256 KiB) and closes the socket — testing the wrong bound. Packed it is
// ~173 KB, under maxPayload, so it reaches the COUNT check this test is about.
const BINARY_FRAME_VERSION = 1
function encodePatchFrame(roomId, instruction) {
  const { entries, ...instructionHeader } = instruction
  const payload = Buffer.alloc(entries.length * 12)
  entries.forEach((e, i) => {
    const o = i * 12
    payload.writeUInt32BE(e.idx, o)
    payload[o + 4] = e.from.r
    payload[o + 5] = e.from.g
    payload[o + 6] = e.from.b
    payload[o + 7] = e.from.a
    payload[o + 8] = e.to.r
    payload[o + 9] = e.to.g
    payload[o + 10] = e.to.b
    payload[o + 11] = e.to.a
  })
  const header = Buffer.from(
    JSON.stringify({ type: "draw", roomId, instruction: instructionHeader }),
    "utf8",
  )
  const frame = Buffer.alloc(3 + header.length + payload.length)
  frame[0] = BINARY_FRAME_VERSION
  frame[1] = (header.length >> 8) & 0xff
  frame[2] = header.length & 0xff
  header.copy(frame, 3)
  payload.copy(frame, 3 + header.length)
  return frame
}

let pass = 0
let fail = 0
const ok = (m) => {
  console.log(`  ✓ ${m}`)
  pass += 1
}
const bad = (m) => {
  console.log(`  ✗ ${m}`)
  fail += 1
}
const note = (m) => console.log(`  ℹ ${m}`)

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?roomId=${encodeURIComponent(ROOM)}`)
    ws.addEventListener("open", () => resolve(ws))
    ws.addEventListener("error", () =>
      reject(new Error(`could not open ${WS_BASE}/ws`)),
    )
  })
}

function waitFor(ws, predicate, ms = 3000) {
  return new Promise((resolve) => {
    const onMsg = (event) => {
      let m
      try {
        m = JSON.parse(event.data)
      } catch {
        return
      }
      if (predicate(m)) {
        clearTimeout(timer)
        ws.removeEventListener("message", onMsg)
        resolve(m)
      }
    }
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMsg)
      resolve(null)
    }, ms)
    ws.addEventListener("message", onMsg)
  })
}

// A ping/pong round trip is the cheapest proof that the event loop was never
// blocked — the failure mode these guards exist to prevent is a synchronous
// stall that freezes every room, not a crash.
async function stillAlive(ws) {
  ws.send(JSON.stringify({ type: "ping", sentAt: Date.now() }))
  return (await waitFor(ws, (m) => m.type === "pong", 3000)) !== null
}

console.log(`security probe -> ${BASE} (room "${ROOM}")\n`)

// --- 1. Unknown message types are rejected, not passed through --------------
// The envelope is validated against an allow-list of known shapes. Previously
// `JSON.parse(text) as ClientSocketMessage` asserted the shape at compile time
// and verified precisely nothing at runtime.
{
  const ws = await connect()
  await waitFor(ws, (m) => m.type === "ready")
  ws.send(JSON.stringify({ type: "drop_database", roomId: ROOM }))
  const err = await waitFor(ws, (m) => m.type === "error", 2000)
  if (err) ok("unknown message type rejected with an error")
  else bad("unknown message type produced NO error")
  if (await stillAlive(ws)) ok("server responsive after unknown type")
  else bad("server stopped responding after unknown type")
  ws.close()
}

// --- 2. An oversized patch is dropped, never applied or broadcast -----------
// Every entry below is individually valid; only the LIST is illegal. That is
// exactly what per-entry validation cannot catch, and it was unbounded until
// MAX_PATCH_ENTRIES existed. Sent as a binary frame so it clears maxPayload and
// actually reaches the count bound in decodePatchEntries (see encodePatchFrame).
{
  const a = await connect()
  const b = await connect()
  await waitFor(a, (m) => m.type === "ready")
  await waitFor(b, (m) => m.type === "ready")

  const entries = Array.from({ length: MAX_PATCH_ENTRIES + 1 }, () => ({
    idx: 0,
    from: { r: 0, g: 0, b: 0, a: 0 },
    to: { r: 255, g: 0, b: 0, a: 255 },
  }))

  let broadcastSeen = false
  b.addEventListener("message", (event) => {
    try {
      const m = JSON.parse(event.data)
      if (m.type === "draw" && m.instruction?.type === "patch") {
        broadcastSeen = true
      }
    } catch {
      /* other traffic (incl. binary frames) is not this check's concern */
    }
  })

  a.send(
    encodePatchFrame(ROOM, {
      type: "patch",
      entries,
      instructionId: 1,
      sessionId: "probe",
    }),
  )

  await new Promise((r) => setTimeout(r, 1200))
  if (!broadcastSeen) ok("oversized patch never broadcast to other clients")
  else bad("oversized patch WAS broadcast")
  if (await stillAlive(a)) ok("server responsive after oversized patch")
  else bad("server stopped responding after oversized patch")

  a.close()
  b.close()
}

// --- 3. A frame past maxPayload cannot take the server down ----------------
{
  const big = await connect()
  await waitFor(big, (m) => m.type === "ready")
  const closed = new Promise((resolve) => {
    big.addEventListener("close", (event) => resolve(event.code))
  })

  big.send(
    JSON.stringify({
      type: "draw",
      roomId: ROOM,
      filler: "x".repeat(8 * 1024 * 1024),
    }),
  )

  const code = await Promise.race([
    closed,
    new Promise((r) => setTimeout(() => r(null), 5000)),
  ])
  if (code === 1009) {
    ok("over-limit frame closed the offending socket with 1009")
  } else {
    note(
      `no 1009 surfaced (code ${code}) — acceptable only if a proxy dropped the frame before the backend saw it`,
    )
  }

  // The invariant that must hold through every path.
  const other = await connect()
  const ready = await waitFor(other, (m) => m.type === "ready", 4000)
  if (ready) ok("a NEW client can still join after the abusive frame")
  else bad("server did not accept a new client after the abusive frame")
  other.close()
  try {
    big.close()
  } catch {
    /* already closed by the server */
  }
}

console.log(
  `\n${fail === 0 ? "security probe PASSED" : "security probe FAILED"} (${pass} passed, ${fail} failed)`,
)
process.exit(fail === 0 ? 0 : 1)
