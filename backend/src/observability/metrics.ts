//#region Why this exists
// Prometheus metrics for the running server. The load-test harness already
// proves what this system CAN do (p50 30 ms / p95 80 ms broadcasts at 50+
// clients); none of that said anything about what production is doing right
// now. This module makes the same quantities continuously observable: a
// scraper polls GET /api/metrics and gets counters, gauges and latency
// histograms in the Prometheus text format every dashboard tool ingests.
//
// prom-client is used (the standard Node client) rather than hand-rolling:
// histogram bucketing and the default runtime metrics — event-loop lag, GC
// pauses, heap — are exactly the wheels not worth reinventing. Everything else
// here stays dependency-free.
//
// Two rules the call sites follow:
//   - Bounded label values ONLY. Every label below comes from a closed set
//     (protocol message types, route templates, status codes) — never a room
//     id, user id or URL, each of which would grow a fresh time series per
//     value until the scrape response and the scraper's memory fall over.
//   - The hot path pays one counter bump or one histogram observe (an array
//     index increment) — no allocation, no string building beyond the label.
//#endregion

//#region Imports
import { timingSafeEqual, createHash } from "crypto"
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client"

import { log } from "./log"

import type { NextFunction, Request, Response } from "express"
//#endregion

//#region Registry & instruments
// A dedicated registry, not prom-client's implicit global one: tests can
// import this module repeatedly (vitest isolates by file, not by import) and a
// registry we own is a registry we can reset without touching global state.
export const registry = new Registry()

collectDefaultMetrics({ register: registry })

export const wsMessagesReceived = new Counter({
  name: "ws_messages_received_total",
  help: "Client->server socket messages after parsing, by protocol type ('invalid' for frames that failed to parse).",
  labelNames: ["type"] as const,
  registers: [registry],
})

export const wsMessagesRateLimited = new Counter({
  name: "ws_messages_rate_limited_total",
  help: "Messages the per-socket rate limiter refused, by decision (drop = discarded, close = socket terminated).",
  labelNames: ["decision"] as const,
  registers: [registry],
})

export const wsSendsDropped = new Counter({
  name: "ws_sends_dropped_total",
  help: "Server->client sends skipped because the socket's kernel buffer exceeded the backpressure cap (the client resyncs via the revision heartbeat).",
  registers: [registry],
})

export const wsUpgradesRejected = new Counter({
  name: "ws_upgrades_rejected_total",
  help: "WebSocket upgrade attempts refused before a socket existed, by reason (origin = CSWSH allowlist, cap = per-identity connection cap).",
  labelNames: ["reason"] as const,
  registers: [registry],
})

export const wsBroadcastDuration = new Histogram({
  name: "ws_broadcast_duration_seconds",
  help: "Server-side time to fan one message out to every open socket in a room.",
  // The load test put p95 client-observed broadcast latency at 80 ms; the
  // server-side fan-out is a fraction of that, so the buckets centre well
  // below it — an observation landing in the top buckets IS the anomaly.
  buckets: [0.0001, 0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [registry],
})

export const wsBroadcastRecipients = new Histogram({
  name: "ws_broadcast_recipients",
  help: "Sockets targeted per broadcast (fan-out width).",
  buckets: [1, 2, 5, 10, 25, 50, 100, 250],
  registers: [registry],
})

export const eventFlushDuration = new Histogram({
  name: "event_flush_duration_seconds",
  help: "Time to append one room's buffered draw events to Postgres.",
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
})

export const eventFlushBatchSize = new Histogram({
  name: "event_flush_batch_size",
  help: "Draw events written per flush batch.",
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [registry],
})

export const eventFlushFailures = new Counter({
  name: "event_flush_failures_total",
  help: "Flush batches that failed and were returned to the buffer for retry. A rising rate means Postgres is rejecting writes — durability is running on the retry loop.",
  registers: [registry],
})

export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency by method, route template and status code.",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
})
//#endregion

//#region Runtime gauges
// Gauges that READ live state at scrape time instead of being pushed to.
// prom-client calls `collect()` on each during every scrape, so the values are
// exact at the moment of observation and cost nothing between scrapes.
//
// Structural parameter types, not imports of RoomManager/pg: this module must
// stay import-cycle-free (roomManager imports it), and a gauge needs three
// numbers, not the classes that carry them.
interface RuntimeSources {
  /** `wss.clients` — the set of every open socket. */
  sockets: { clients: Set<unknown> }
  /** RoomManager — rooms currently resident in memory. */
  rooms: { roomCount: number }
  /** The pg Pool's live counters. */
  pool: { totalCount: number; idleCount: number; waitingCount: number }
}

let runtimeCollectorsRegistered = false

export function registerRuntimeCollectors(sources: RuntimeSources): void {
  // Idempotent: registering the same gauge name twice throws in prom-client,
  // and server startup is exactly the kind of code that gets re-run in tests.
  if (runtimeCollectorsRegistered) {
    return
  }
  runtimeCollectorsRegistered = true

  new Gauge({
    name: "ws_connections_active",
    help: "Open WebSocket connections.",
    registers: [registry],
    collect() {
      this.set(sources.sockets.clients.size)
    },
  })

  new Gauge({
    name: "rooms_active",
    help: "Rooms currently loaded in memory (with timers running).",
    registers: [registry],
    collect() {
      this.set(sources.rooms.roomCount)
    },
  })

  new Gauge({
    name: "pg_pool_clients",
    help: "Postgres pool clients by state.",
    labelNames: ["state"] as const,
    registers: [registry],
    collect() {
      this.set({ state: "total" }, sources.pool.totalCount)
      this.set({ state: "idle" }, sources.pool.idleCount)
      this.set({ state: "waiting" }, sources.pool.waitingCount)
    },
  })
}
//#endregion

//#region HTTP middleware
// Records every HTTP request's latency, keyed by ROUTE TEMPLATE (`req.route` —
// e.g. "/api/auth/login"), never the raw URL: raw URLs carry ids and
// attacker-chosen junk, which is the unbounded-label mistake described at the
// top of the file. Requests no route matched are folded into "unmatched", and
// the static-site fallback (which never sets req.route) into "static".
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint()
  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - start) / 1e9
    const route =
      (req.route as { path?: string } | undefined)?.path ??
      (req.path.startsWith("/api") ? "unmatched" : "static")
    httpRequestDuration.observe(
      { method: req.method, route, status: String(res.statusCode) },
      seconds,
    )
  })
  next()
}
//#endregion

//#region /api/metrics auth + handler
// The metrics response enumerates routes, connection counts and error rates —
// a free reconnaissance page if it were public. Access follows the same
// per-environment posture as the origin allowlist (security/origin.ts):
//
//   - METRICS_TOKEN set: require it, as `Authorization: Bearer <token>` or as
//     the password half of Basic auth (Grafana Cloud's scraper sends Basic;
//     the username is ignored).
//   - unset in development: open, with a one-time warning — a fresh checkout
//     should let you curl your own metrics.
//   - unset in production: 404, fail closed. Not 401: a 401 confirms the
//     endpoint exists and invites guessing; an unconfigured endpoint should
//     not advertise itself.
function constantTimeMatch(presented: string, expected: string): boolean {
  // Hash both sides to fixed length so timingSafeEqual accepts them and the
  // comparison leaks nothing about where the strings diverge.
  const a = createHash("sha256").update(presented).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header) {
    return false
  }
  if (header.startsWith("Bearer ")) {
    return constantTimeMatch(header.slice("Bearer ".length), token)
  }
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8")
    // RFC 7617: credentials are user-id ":" password; the user-id may not
    // contain ":", so the FIRST colon splits them.
    const colon = decoded.indexOf(":")
    return colon >= 0 && constantTimeMatch(decoded.slice(colon + 1), token)
  }
  return false
}

let warnedUnconfigured = false

export function metricsAuth(req: Request, res: Response, next: NextFunction): void {
  // Read per request, not at import — tests flip these, and it keeps this
  // module import-order-independent of dotenv-style env loading.
  const token = process.env.METRICS_TOKEN
  const isProduction = process.env.NODE_ENV === "production"

  if (!token) {
    if (isProduction) {
      res.status(404).end()
      return
    }
    if (!warnedUnconfigured) {
      warnedUnconfigured = true
      log.warn(
        "METRICS_TOKEN is unset — /api/metrics is OPEN in development. " +
          "Production returns 404 until it is set.",
      )
    }
    next()
    return
  }

  if (authorized(req.headers.authorization, token)) {
    next()
    return
  }

  res.status(401).set("WWW-Authenticate", 'Basic realm="metrics"').end()
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.set("Content-Type", registry.contentType)
  res.send(await registry.metrics())
}
//#endregion
