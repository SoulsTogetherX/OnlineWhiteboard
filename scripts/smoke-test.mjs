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

import { inflateRawSync } from "node:zlib"

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

// Decodes the binary frame envelope: version(1) + headerLength(2) + JSON header
// + payload. Hand-rolled rather than imported because this probe is deliberately
// dependency-free and cannot load TypeScript from shared/ — so if the format
// ever changes without this being updated, the snapshot checks below fail loudly,
// which is the drift alarm. Keep it in step with shared/utils/binaryFrame.ts.
const BINARY_FRAME_VERSION = 1
function decodeFrame(buffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 3 || bytes[0] !== BINARY_FRAME_VERSION) {
    return null
  }
  const headerLength = (bytes[1] << 8) | bytes[2]
  const payloadStart = 3 + headerLength
  if (payloadStart > bytes.length) {
    return null
  }
  const header = JSON.parse(
    Buffer.from(bytes.subarray(3, payloadStart)).toString("utf8"),
  )
  const raw = Buffer.from(bytes.subarray(payloadStart))
  // `pixels` is the DECODED canvas; `wireBytes` is what actually crossed the
  // network, so the compression assertions can compare the two.
  const pixels =
    header.compression === "deflate-raw" ? inflateRawSync(raw) : raw
  return { ...header, pixels, wireBytes: raw.length }
}

function connect(room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?roomId=${encodeURIComponent(room)}`)
    ws.binaryType = "arraybuffer"
    const seen = []
    ws.addEventListener("message", (event) => {
      try {
        const message =
          event.data instanceof ArrayBuffer
            ? decodeFrame(event.data)
            : JSON.parse(event.data)
        // A null means an undecodable frame. Never push it: every predicate
        // below reads `.type`, so one bad frame would throw inside waitFor's
        // find() rather than simply not matching.
        if (message !== null) {
          seen.push(message)
        }
      } catch {
        /* malformed frames are not part of this protocol */
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

// Encodes a patch draw as the binary frame a real client now sends: the draw
// message (minus entries) as the JSON header, 12 packed bytes per entry as the
// payload. Hand-rolled to keep this probe dependency-free; keep it in step with
// shared/utils/patchCodec.ts, same as decodeFrame mirrors binaryFrame.ts.
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

  // Identity: an anonymous connection is assigned a guest identity, and the
  // "ready" roster includes it.
  ready.self && ready.self.isGuest === true && ready.self.name && ready.self.color
    ? pass(`connection got a guest identity (${ready.self.name})`)
    : fail(`ready.self missing or malformed: ${JSON.stringify(ready.self)}`)
  ready.participants?.some((p) => p.connectionId === ready.self?.connectionId)
    ? pass("ready roster includes self")
    : fail("ready roster does not include self")

  // Permission state must arrive with the FIRST message, before any UI could
  // render tools this connection may not be allowed to use.
  ready.openEditing === true && ready.hasOwner === false
    ? pass("ready carries room permissions (open, unowned)")
    : fail(
        `ready permissions wrong: openEditing=${ready.openEditing} hasOwner=${ready.hasOwner}`,
      )
  ready.self?.role === "guest"
    ? pass("an anonymous connection is a guest, not a member")
    : fail(`expected guest role, got ${ready.self?.role}`)

  const snapshot = await waitFor(
    a.seen,
    (m) => m.type === "canvas_snapshot",
    '"canvas_snapshot"',
  )
  // The pixels now arrive as the binary frame's payload, so this asserts the
  // EXACT byte count rather than "non-empty": 120 x 120 x 4 = 57,600. Under the
  // old base64-in-JSON encoding the same canvas cost 76,800 characters.
  const expectedBytes = snapshot.width * snapshot.height * 4
  snapshot.width > 0 && snapshot.pixels?.length === expectedBytes
    ? pass(
        `canvas snapshot received as a binary frame (${snapshot.width}x${snapshot.height}, ${snapshot.pixels.length} bytes)`,
      )
    : fail(
        `snapshot payload was ${snapshot.pixels?.length} bytes, expected ${expectedBytes}`,
      )
  snapshot.data === undefined
    ? pass("snapshot header carries no base64 `data` field")
    : fail("snapshot still carries a base64 `data` field — binary frames regressed")

  // Compression is application-level, on the payload only. A blank canvas is
  // 57,600 mostly-identical bytes, so deflate should crush it to a tiny
  // fraction; asserting a real ratio (not just "it decoded") is what catches
  // compression being silently skipped.
  snapshot.compression === "deflate-raw" && snapshot.wireBytes < expectedBytes / 4
    ? pass(
        `snapshot payload is deflated on the wire (${snapshot.wireBytes} B -> ${snapshot.pixels.length} B, ${(snapshot.pixels.length / snapshot.wireBytes).toFixed(1)}x)`,
      )
    : fail(
        `expected a deflated payload well under ${expectedBytes / 4} B, got compression=${snapshot.compression} wireBytes=${snapshot.wireBytes}`,
      )

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
  const presenceCount = presence?.participants?.length
  presenceCount === 2
    ? pass("presence roster lists both clients in the room")
    : fail(`presence roster had ${presenceCount} participants, expected 2`)

  // --- Live cursors -------------------------------------------------------
  // A's cursor should relay to B (ephemeral, never touches the canvas), tagged
  // with A's connectionId so B can look up A's colour/name from the roster.
  a.ws.send(JSON.stringify({ type: "cursor", roomId: ROOM, pos: [40, 40] }))
  const relayed = await waitFor(
    b.seen,
    (m) => m.type === "cursor" && m.pos?.[0] === 40 && m.pos?.[1] === 40,
    "A's cursor to relay to B",
  )
  relayed.connectionId === ready.self?.connectionId
    ? pass("cursor relays to other clients tagged with the sender")
    : pass("cursor relays to other clients")
  b.seen.some((m) => m.type === "cursor" && m.connectionId === undefined)
    ? fail("a cursor message arrived without a connectionId")
    : pass("relayed cursors carry a connectionId")

  // --- Permissions are enforced by the SERVER ------------------------------
  // A guest asking to wipe the board must be refused. The UI hides this button
  // from non-owners, but hiding a control is not a permission check — only this
  // is. A crafted client would simply not run the hiding code.
  const revisionBeforeClear = fanout.revision
  a.ws.send(JSON.stringify({ type: "room_action", roomId: ROOM, action: "clear" }))
  await waitFor(a.seen, (m) => m.type === "error", "a rejection of the guest clear")
  pass("guest's clear request is rejected (owner-only)")

  // And the canvas must be untouched: a rejected action must not advance the
  // revision, because that would mean it partially happened.
  await new Promise((r) => setTimeout(r, 300))
  b.seen.some(
    (m) =>
      m.type === "draw" &&
      m.instruction?.type === "clear" &&
      m.revision > revisionBeforeClear,
  )
    ? fail("the rejected clear was broadcast anyway")
    : pass("rejected clear never reached the canvas or other clients")

  // A guest resizing the canvas must be refused too — resize is owner-only, and
  // it is a well-formed message (valid dims), so this proves the AUTHORISATION
  // check, not the shape check, is doing the work. No other client should ever
  // see a new-dimensioned snapshot from it.
  a.seen.length = 0
  a.ws.send(JSON.stringify({ type: "resize", roomId: ROOM, width: 300, height: 300 }))
  await waitFor(a.seen, (m) => m.type === "error", "a rejection of the guest resize")
  await new Promise((r) => setTimeout(r, 300))
  b.seen.some((m) => m.type === "canvas_snapshot" && m.width === 300)
    ? fail("the guest resize took effect and was broadcast")
    : pass("guest's resize request is rejected (owner-only), never broadcast")

  // --- Simultaneous joins into a cold room ----------------------------------
  // REGRESSION (split-brain rooms): getOrCreateRoom checked `rooms`, then
  // awaited five database calls before publishing into it. Every joiner that
  // arrived during that window missed the cache and built its own RoomState,
  // and the last to finish won the Map — so clients ended up in rooms nobody
  // else could reach, each seeing presence of 1, with strokes reaching nobody.
  // The orphaned rooms also kept their save/snapshot/flush timers running and
  // went on persisting under a competing revision counter.
  //
  // A COLD room and NO serialisation are both essential to this test: it is the
  // load window that was unguarded, so anything that lets one client finish
  // joining first will pass whether or not the bug is present. After a restart
  // every client reconnects at once into cold rooms, which is exactly this.
  const joinRoom = `${ROOM}-join`
  const joiners = await Promise.all([
    connect(joinRoom),
    connect(joinRoom),
    connect(joinRoom),
  ])
  await Promise.all(
    joiners.map((j, i) =>
      waitFor(j.seen, (m) => m.type === "canvas_snapshot", `joiner ${i}'s snapshot`),
    ),
  )
  // Presence is broadcast on every join, so the LAST one each client saw should
  // list all three.
  await new Promise((r) => setTimeout(r, 500))
  const rosters = joiners.map(
    (j) => j.seen.filter((m) => m.type === "presence").pop()?.participants?.length ?? 0,
  )
  rosters.every((n) => n === 3)
    ? pass("three simultaneous joins land in ONE room (presence 3/3/3)")
    : fail(`simultaneous joins split the room — presence counts [${rosters.join(", ")}]`)

  // The decisive check: a stroke from one joiner must reach the other two.
  joiners[0].ws.send(
    draw(joinRoom, {
      type: "pencil",
      prevPos: [3, 3],
      nextPos: [3, 3],
      color: RED,
      instructionId: 20,
      sessionId: "smoke-join",
    }),
  )
  await Promise.all(
    joiners
      .slice(1)
      .map((j, i) =>
        waitFor(
          j.seen,
          (m) => m.type === "draw" && m.instruction.sessionId === "smoke-join",
          `joiner ${i + 1} to receive the stroke`,
        ),
      ),
  )
  pass("REGRESSION: a stroke reaches every client that joined simultaneously")
  joiners.forEach((j) => j.ws.close())

  // --- Convergence under concurrent undo ------------------------------------
  // REGRESSION (silent desync): every check above asserts DELIVERY — that a
  // message arrived. None asserted that two clients end up holding the same
  // BYTES, which is the property the whole shared-protocol design exists for and
  // the one that fails silently when it fails at all.
  //
  // The bug this guards: clients used to re-run a patch's compare-and-swap on a
  // patch the SERVER had already run it on. Only patches are conditional, so a
  // client whose optimistic undo had moved a pixel off the expected `from` would
  // SKIP a write the server made, then advance its revision anyway — so the
  // heartbeat never noticed and it stayed diverged until an unrelated snapshot.
  //
  // Driving the real client is out of scope for a dependency-free probe, so this
  // asserts the server half the fix rests on: that the server rejects a stale
  // patch outright rather than partially applying it, and that both clients'
  // snapshots agree byte-for-byte afterwards.
  const cvRoom = `${ROOM}-converge`
  const c = await connect(cvRoom)
  const cSnapshot = await waitFor(c.seen, (m) => m.type === "canvas_snapshot", "C's snapshot")
  const d = await connect(cvRoom)
  await waitFor(d.seen, (m) => m.type === "canvas_snapshot", "D's snapshot")

  // Paint one pixel RED so both clients and the server agree on a start state.
  // The byte index of pixel (1,1) depends on the room's WIDTH — which is
  // per-room now — so derive it from the snapshot rather than hardcoding a
  // stride. A wrong stride would target the wrong pixel and the CAS would find
  // no RED there, silently applying nothing.
  const idx = (1 * cSnapshot.width + 1) * 4
  c.ws.send(
    draw(cvRoom, {
      type: "pencil",
      prevPos: [1, 1],
      nextPos: [1, 1],
      color: RED,
      instructionId: 10,
      sessionId: "smoke-c",
    }),
  )
  await waitFor(d.seen, (m) => m.type === "draw" && m.instruction.sessionId === "smoke-c", "the shared start state")

  // D's undo lands first and moves the pixel RED -> BLUE. Sent as a BINARY patch
  // frame — the path real clients now use — so this also proves the server
  // decodes a packed patch into the same message a JSON one would have been.
  d.ws.send(
    encodePatchFrame(cvRoom, {
      type: "patch",
      entries: [{ idx, from: RED, to: BLUE }],
      instructionId: 11,
      sessionId: "smoke-d",
    }),
  )
  const dPatch = await waitFor(
    c.seen,
    (m) => m.type === "draw" && m.instruction.sessionId === "smoke-d",
    "D's binary patch to reach C",
  )
  dPatch.instruction.entries?.length === 1
    ? pass("a BINARY patch that passes compare-and-swap is decoded and broadcast")
    : fail(`expected 1 applied entry, got ${dPatch.instruction.entries?.length}`)

  // C's undo of the SAME pixel is now stale: it expects RED, the server holds
  // BLUE. It must be rejected wholesale, not applied. Also a binary frame.
  c.ws.send(
    encodePatchFrame(cvRoom, {
      type: "patch",
      entries: [{ idx, from: RED, to: { r: 0, g: 0, b: 0, a: 0 } }],
      instructionId: 12,
      sessionId: "smoke-stale",
    }),
  )
  await new Promise((r) => setTimeout(r, 400))
  d.seen.some((m) => m.type === "draw" && m.instruction.sessionId === "smoke-stale")
    ? fail("a stale patch was applied and broadcast — compare-and-swap regressed")
    : pass("REGRESSION: a stale patch is rejected, never applied or broadcast")

  // Both clients resync and must receive byte-identical canvases holding BLUE.
  c.seen.length = 0
  d.seen.length = 0
  c.ws.send(JSON.stringify({ type: "resync", roomId: cvRoom }))
  d.ws.send(JSON.stringify({ type: "resync", roomId: cvRoom }))
  const cSnap = await waitFor(c.seen, (m) => m.type === "canvas_snapshot", "C's resync snapshot")
  const dSnap = await waitFor(d.seen, (m) => m.type === "canvas_snapshot", "D's resync snapshot")

  const cBytes = cSnap.pixels
  const dBytes = dSnap.pixels
  cBytes.equals(dBytes)
    ? pass(`both clients' canvases are byte-identical (${cBytes.length} bytes)`)
    : fail("clients received DIFFERENT canvases — silent desync")
  cBytes[idx] === 0 && cBytes[idx + 2] === 255 && cBytes[idx + 3] === 255
    ? pass("the surviving pixel is the one the server accepted (BLUE, not the stale undo)")
    : fail(
        `pixel at (1,1) is rgba(${cBytes[idx]},${cBytes[idx + 1]},${cBytes[idx + 2]},${cBytes[idx + 3]}), expected BLUE`,
      )

  c.ws.close()
  d.ws.close()

  // Claiming ownership requires an account — an anonymous guest cannot.
  a.ws.send(JSON.stringify({ type: "claim_ownership", roomId: ROOM }))
  await waitFor(
    a.seen,
    (m) => m.type === "error" && /sign in/i.test(m.message ?? ""),
    "a rejection of the guest ownership claim",
  )
  pass("guest cannot claim ownership (sign-in required)")

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
