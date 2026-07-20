//#region Imports
import express from "express"
import { createServer } from "http"
import { WebSocketServer } from "ws"

import configureRoutes from "./routes"
import configureWebSockets from "./sockets"
import { runMigrations } from "./db/migrate"
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
// patch covering every pixel: MAX_PATCH_ENTRIES entries. As JSON that was ~1.4 MB
// (~95 bytes an entry), which is the ONLY reason this had to be 4 MiB. Now that
// patches travel as a packed binary frame (shared/utils/patchCodec.ts) an entry
// is 12 bytes flat, so the same worst case is MAX_PATCH_ENTRIES * 12 ≈ 173 KB.
// 256 KiB gives that ~1.5x headroom for the frame header and any future slack,
// and every other client->server message is far smaller — so this is now a tight
// bound rather than a loose one, exactly as OWASP prefers.
//
// Phase 4 makes the canvas resizable, which raises MAX_PATCH_ENTRIES with the
// area; this ceiling must be revisited then so a legitimate full-canvas undo on
// the largest allowed canvas still fits.
const MAX_SOCKET_PAYLOAD_BYTES = 256 * 1024

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
