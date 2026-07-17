#!/usr/bin/env node
/**
 * End-to-end smoke test against a RUNNING stack.
 *
 *   docker compose -f docker-compose.prod.yaml up -d
 *   node scripts/smoke-test.mjs http://localhost:8080
 *
 * Zero dependencies on purpose: Node 22 ships a global `fetch` and a global
 * `WebSocket`, so CI can run this with plain `node` — no install, nothing to
 * drift out of date.
 *
 * The unit tests (`npm test`) cover the shared protocol in isolation. This
 * covers everything they cannot: that nginx actually serves the bundle, that it
 * proxies /api and /ws, that the backend talks to Postgres, and that the whole
 * chain agrees. Several checks here are regression tests for specific bugs —
 * each is marked REGRESSION with what it guards.
 */

const BASE = process.argv[2] ?? "http://localhost:8080"
const WS_BASE = BASE.replace(/^http/, "ws")
const ROOM = `smoke-${process.pid}`

const RED = { r: 255, g: 0, b: 0, a: 255 }
const BLUE = { r: 0, g: 0, b: 255, a: 255 }

let failures = 0
const pass = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg) => {
  failures += 1
  console.error(`  ✗ ${msg}`)
}

function connect(room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?roomId=${encodeURIComponent(room)}`)
    const seen = []
    ws.addEventListener("message", (event) => {
      try {
        seen.push(JSON.parse(event.data))
      } catch {
        /* non-JSON frames are not part of this protocol */
      }
    })
    ws.addEventListener("open", () => resolve({ ws, seen }))
    ws.addEventListener("error", () => reject(new Error(`could not open ${WS_BASE}/ws`)))
  })
}

function waitFor(seen, predicate, what, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const poll = () => {
      const hit = seen.find(predicate)
      if (hit) {
        resolve(hit)
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`timed out waiting for ${what}`))
        return
      }
      setTimeout(poll, 25)
    }
    poll()
  })
}

const draw = (roomId, instruction) =>
  JSON.stringify({ type: "draw", roomId, instruction })

async function main() {
  console.log(`smoke test -> ${BASE} (room "${ROOM}")\n`)

  // --- HTTP surface -------------------------------------------------------
  const health = await fetch(`${BASE}/api/health`)
  const healthBody = await health.json().catch(() => ({}))
  health.ok && healthBody.status === "ok"
    ? pass("GET /api/health is proxied to the backend and returns ok")
    : fail(`GET /api/health -> ${health.status} ${JSON.stringify(healthBody)}`)

  const index = await fetch(`${BASE}/`)
  index.ok && (await index.text()).includes("<div id=\"root\">")
    ? pass("nginx serves the built SPA shell")
    : fail(`GET / -> ${index.status}`)

  const spa = await fetch(`${BASE}/some/client/route`)
  spa.ok
    ? pass("unknown routes fall back to index.html (SPA routing)")
    : fail(`SPA fallback -> ${spa.status}, expected 200`)

  // --- WebSocket surface --------------------------------------------------
  const a = await connect(ROOM)
  pass("WebSocket upgrade succeeds through the proxy")

  // REGRESSION (room-load race): the client pings the instant the socket opens.
  // addClient awaits a Postgres read before it is ready, and the message
  // listener used to be attached only AFTER that await — so this ping was
  // silently dropped, the pong never came, and the client's 5s heartbeat
  // timeout tore the connection down in a loop. A cold room (this one is brand
  // new) is exactly the case that broke.
  a.ws.send(JSON.stringify({ type: "ping", sentAt: Date.now() }))

  const ready = await waitFor(a.seen, (m) => m.type === "ready", '"ready"')
  pass(`server sends "ready" (revision ${ready.revision})`)

  const snapshot = await waitFor(
    a.seen,
    (m) => m.type === "canvas_snapshot",
    '"canvas_snapshot"',
  )
  snapshot.width > 0 && snapshot.data.length > 0
    ? pass(`canvas snapshot received (${snapshot.width}x${snapshot.height})`)
    : fail("canvas snapshot was empty")

  await waitFor(a.seen, (m) => m.type === "pong", '"pong" for the ping sent at open')
  pass("REGRESSION: ping sent at open is answered (room-load race)")

  // --- Fan-out ------------------------------------------------------------
  const b = await connect(ROOM)
  await waitFor(b.seen, (m) => m.type === "canvas_snapshot", "B's snapshot")

  a.ws.send(
    draw(ROOM, {
      type: "pencil",
      prevPos: [2, 2],
      nextPos: [9, 9],
      color: RED,
      instructionId: 1,
      sessionId: "smoke-a",
    }),
  )
  const fanout = await waitFor(
    b.seen,
    (m) => m.type === "draw" && m.instruction.sessionId === "smoke-a",
    "A's stroke to reach B",
  )
  fanout.revision > ready.revision
    ? pass(`A's stroke reaches B and the revision advances (-> ${fanout.revision})`)
    : fail("revision did not advance on draw")

  // --- Hostile input ------------------------------------------------------
  // REGRESSION (DoS + validation): coordinates far outside the canvas used to
  // spin Bresenham for a billion iterations, freezing the single-threaded event
  // loop for every room. The legitimate stroke sent immediately after is the
  // real assertion: if the server were wedged or the instruction were applied,
  // this would time out or the hostile broadcast would appear.
  a.ws.send(
    draw(ROOM, {
      type: "pencil",
      prevPos: [0, 0],
      nextPos: [1_000_000_000, 1_000_000_000],
      color: RED,
      instructionId: 2,
      sessionId: "smoke-hostile",
    }),
  )
  a.ws.send(
    draw(ROOM, {
      type: "pencil",
      prevPos: [1, 1],
      nextPos: [5, 5],
      color: BLUE,
      instructionId: 3,
      sessionId: "smoke-good",
    }),
  )

  await waitFor(
    b.seen,
    (m) => m.type === "draw" && m.instruction.sessionId === "smoke-good",
    "a legitimate stroke sent right after a hostile one",
  )
  pass("REGRESSION: server stays responsive after a hostile instruction (DoS)")

  b.seen.some((m) => m.type === "draw" && m.instruction.sessionId === "smoke-hostile")
    ? fail("hostile instruction was applied and broadcast — validation regressed")
    : pass("REGRESSION: out-of-bounds instruction rejected, never broadcast")

  // --- Presence -----------------------------------------------------------
  const presence = a.seen.filter((m) => m.type === "presence").pop()
  presence?.activeUsers === 2
    ? pass("presence reports both clients in the room")
    : fail(`presence reported ${presence?.activeUsers}, expected 2`)

  a.ws.close()
  b.ws.close()
}

main()
  .then(() => {
    console.log(failures === 0 ? "\nsmoke test PASSED" : `\nsmoke test FAILED (${failures})`)
    process.exit(failures === 0 ? 0 : 1)
  })
  .catch((error) => {
    console.error(`\nsmoke test ERROR: ${error.message}`)
    process.exit(1)
  })
