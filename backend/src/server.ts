//#region Imports
import express from "express"
import { createServer } from "http"
import { WebSocketServer } from "ws"

import configureRoutes from "./routes"
import configureStaticSite from "./staticSite"
import configureWebSockets from "./sockets"
import { runMigrations } from "./db/migrate"
import { assertEmailSecretsPresent } from "./auth/emailCrypto"
import { warnIfMailerUnconfigured } from "./auth/mailer"
import pool from "./db/pool"
import { log } from "./observability/log"
import { registerRuntimeCollectors } from "./observability/metrics"

import { MAX_PATCH_ENTRIES_PER_MESSAGE } from "@shared/constants/canvas"
import { BYTES_PER_ENTRY } from "@shared/utils/patchCodec"
//#endregion

//#region Setup App & Sever
const app = express()
const server = createServer(app)
// Largest client->server frame we will even buffer. `ws` defaults to 100 MiB,
// which means a single message could ask the server to allocate and parse 100 MB
// before any of our validation ran — validation cannot protect you from a
// payload it never gets to see.
//
// The bound is derived from the biggest LEGITIMATE frame, not guessed. The only
// bulky client->server message is an undo patch, and a patch is now capped PER
// MESSAGE at MAX_PATCH_ENTRIES_PER_MESSAGE entries: a larger undo is split
// client-side into several messages (shared/utils/patchCodec chunkPatchEntries),
// and the server rejects any single patch over that cap (validateInstruction). So
// the worst legitimate frame is one full chunk — MAX_PATCH_ENTRIES_PER_MESSAGE *
// 11 packed bytes ≈ 176 KB — plus the small JSON/binary-frame header; 64 KiB of
// headroom covers the header comfortably (~240 KiB total).
//
// Deriving it from the SAME shared constants the client chunks by and the
// validator enforces means the three cannot drift: shrink the per-message cap and
// this shrinks with it. This is ~12x tighter than the previous 3 MiB ceiling
// (which had to cover a whole 262,144-entry full-canvas undo in one frame), and
// the split is invisible to the result because every patch entry is an
// independent compare-and-swap.
const MAX_SOCKET_PAYLOAD_BYTES =
  MAX_PATCH_ENTRIES_PER_MESSAGE * BYTES_PER_ENTRY + 64 * 1024

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
// No-op unless STATIC_DIR is set (single-container deploys — see staticSite.ts).
// After the routes on purpose: its SPA fallback must never shadow /api.
configureStaticSite(app)
const roomManager = configureWebSockets(wss, server)

// Live gauges (open sockets, resident rooms, pg pool state) read their sources
// at scrape time; registered here because this is the one place all three
// exist. See observability/metrics.ts.
registerRuntimeCollectors({ sockets: wss, rooms: roomManager, pool })
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
  log.info("draining rooms before exit", { signal })

  // Stop taking new HTTP/WS connections; in-flight ones finish.
  server.close()

  try {
    await roomManager.shutdown()
    await pool.end()
    log.info("shutdown complete", { signal })
    process.exit(0)
  } catch (error) {
    log.error("error during shutdown", { signal, error })
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

  // Email verification and password reset are OPTIONAL (nothing requires a
  // verified address), so unlike the email-at-rest secrets above this does NOT
  // fail closed — it only warns if SMTP is unset. The server boots either way;
  // without SMTP those two emails are logged to the console instead of sent.
  warnIfMailerUnconfigured()

  await runMigrations()

  // Only now that the schema exists is it safe to start the cleanup sweep, which
  // queries the rooms table. (The heartbeat, started earlier in
  // configureWebSockets, touches no database and so runs before this.)
  roomManager.startCleanup()

  server.listen(port, () => {
    log.info("server listening", { base: process.env.API_BASE, port })
  })
}

start().catch((error) => {
  log.error("fatal startup error", { error })
  process.exit(1)
})
//#endregion
