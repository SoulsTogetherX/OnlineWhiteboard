//#region Imports
import express from "express"
import { createServer } from "http"
import { WebSocketServer } from "ws"

import configureRoutes from "./routes"
import configureWebSockets from "./sockets"
import { runMigrations } from "./db/migrate"
import { assertEmailSecretsPresent } from "./auth/emailCrypto"
import pool from "./db/pool"
//#endregion

//#region Setup App & Sever
const app = express()
const server = createServer(app)
// Largest client->server frame we will even buffer. `ws` defaults to 100 MiB,
// which means a single message could ask the server to allocate and parse 100 MB
// before any of our validation ran — validation cannot protect you from a
// payload it never gets to see.
//
// The bound is derived, not guessed. The biggest LEGITIMATE message is an undo
// patch covering every pixel of the LARGEST allowed canvas: MAX_PATCH_ENTRIES
// (= MAX_CANVAS_DIMENSION^2 = 512^2 = 262,144) entries. Patches travel as a
// packed binary frame (shared/utils/patchCodec.ts) at 12 bytes an entry, so that
// worst case is 262,144 * 12 ≈ 3.0 MB. 4 MiB gives that ~1.3x headroom for the
// frame header, and every other client->server message is far smaller.
//
// This rose from 256 KiB when the max canvas grew to 512 in Phase 4: a bigger
// canvas means a bigger legitimate full-canvas undo, and the ceiling has to fit
// it. Still ~25x below the `ws` 100 MiB default, and the binary patch encoding
// is what keeps even this in the low megabytes rather than the ~25 MB the old
// JSON encoding would have needed for the same canvas.
const MAX_SOCKET_PAYLOAD_BYTES = 4 * 1024 * 1024

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_SOCKET_PAYLOAD_BYTES,
  // Explicitly off. `ws` does not enable permessage-deflate by default, but
  // saying so here is deliberate: OWASP advises against transport-level
  // compression because sharing a compression context between attacker-supplied
  // data and secrets leaks content through compressed SIZE (the CRIME/BREACH
  // class). Phase 3 compresses the snapshot PAYLOAD explicitly instead, so the
  // compressed buffer holds only pixel bytes and no oracle exists.
  perMessageDeflate: false,
})

const port = process.env.BACKEND_PORT || 3000
//#endregion

//#region Configure
// Body parsing lives in configureRoutes alongside the routes that need it.
configureRoutes(app)
const roomManager = configureWebSockets(wss, server)
//#endregion

//#region Graceful Shutdown
// `docker stop` (and therefore every deploy) sends SIGTERM, then SIGKILLs after
// a grace period. Without a handler the process just dies, dropping whatever
// each room had buffered since its last event flush — the one gap the event log
// can't recover, because those events never reached Postgres.
//
// So on the signal we: stop accepting new connections, flush every room's
// buffered events and write a final snapshot, close the DB pool, and exit. This
// is only reachable because the Dockerfile runs `node` as PID 1 (not `npm`), so
// the signal actually arrives at this process.
let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  console.log(`${signal} received — draining rooms before exit`)

  // Stop taking new HTTP/WS connections; in-flight ones finish.
  server.close()

  try {
    await roomManager.shutdown()
    await pool.end()
    console.log("Shutdown complete")
    process.exit(0)
  } catch (error) {
    console.error("Error during shutdown:", error)
    process.exit(1)
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
//#endregion

//#region Startup
// Migrate BEFORE listening. If the schema isn't ready, the first WebSocket
// connection would try to load a canvas from a table that doesn't exist yet and
// crash — so we bring the database to the latest schema first, and only then
// open the port. A migration failure aborts startup (runMigrations throws); the
// container's restart policy retries, which is the right behaviour when the
// database is briefly unreachable at boot.
async function start(): Promise<void> {
  // Before ANYTHING else, and before the port opens: read the email secrets so a
  // deploy missing them dies here instead of at the first person who signs up.
  // The fail-closed check inside emailCrypto only fires when it is reached, and
  // every other caller is lazy (register/login) — so without this, "refuses to
  // start in production" was aspirational rather than true.
  assertEmailSecretsPresent()

  await runMigrations()

  // Only now that the schema exists is it safe to start the cleanup sweep, which
  // queries the rooms table. (The heartbeat, started earlier in
  // configureWebSockets, touches no database and so runs before this.)
  roomManager.startCleanup()

  server.listen(port, () => {
    console.log(`Server is running on ${process.env.API_BASE}:${port}`)
  })
}

start().catch((error) => {
  console.error("Fatal startup error:", error)
  process.exit(1)
})
//#endregion
