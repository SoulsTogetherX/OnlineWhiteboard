#!/usr/bin/env node
/**
 * Observability probe against a RUNNING stack.
 *
 *   docker compose -f docker-compose.prod.yaml up -d
 *   METRICS_TOKEN=... node scripts/metrics-probe.mjs http://localhost:8080
 *
 * Zero dependencies, same as smoke-test.mjs: Node 22's global `fetch` is all
 * this needs.
 *
 * What it proves that the unit tests cannot: that the RUNNING server actually
 * exports the metrics the dashboards and alerts are built on. A metric that
 * silently stops being registered (a refactor drops an import, a rename misses
 * a call site) breaks every alert built on it while everything else stays
 * green — this is the drift alarm. It also proves the auth posture end to end:
 * the endpoint must refuse an unauthenticated scrape in production mode.
 */

const BASE = process.argv[2] ?? "http://localhost:8080"
const TOKEN = process.env.METRICS_TOKEN ?? ""

let failures = 0
const pass = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg) => {
  failures += 1
  console.error(`  ✗ ${msg}`)
}

// Every series an alert or dashboard panel references belongs in this list —
// adding a panel on a new series means adding the series here, so CI starts
// guarding it the same day.
const REQUIRED_SERIES = [
  // Instrumented in backend/src/observability/metrics.ts
  "ws_messages_received_total",
  "ws_messages_rate_limited_total",
  "ws_sends_dropped_total",
  "ws_upgrades_rejected_total",
  "ws_broadcast_duration_seconds",
  "ws_broadcast_recipients",
  "event_flush_duration_seconds",
  "event_flush_batch_size",
  "event_flush_failures_total",
  "http_request_duration_seconds",
  // Runtime gauges (registerRuntimeCollectors in server.ts)
  "ws_connections_active",
  "rooms_active",
  "pg_pool_clients",
  // prom-client defaults — the Node vitals
  "nodejs_eventloop_lag_seconds",
  "process_resident_memory_bytes",
]

async function main() {
  console.log(`metrics probe against ${BASE}`)

  // --- auth posture ---------------------------------------------------------
  // The production stack sets NODE_ENV=production, so an unauthenticated
  // scrape must be refused: 401 when METRICS_TOKEN is configured, 404 when it
  // is not. 200 means the recon page is public — a hard failure either way.
  const unauthenticated = await fetch(`${BASE}/api/metrics`)
  if (unauthenticated.status === 401 || unauthenticated.status === 404) {
    pass(`unauthenticated scrape refused (${unauthenticated.status})`)
  } else {
    fail(`unauthenticated scrape returned ${unauthenticated.status}, expected 401/404`)
  }

  if (!TOKEN) {
    fail("METRICS_TOKEN is not set in the probe's environment — cannot verify the authenticated path")
    return
  }

  // --- authenticated scrape -------------------------------------------------
  const scrape = await fetch(`${BASE}/api/metrics`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  })
  if (scrape.status === 200) {
    pass("authenticated scrape returns 200")
  } else {
    fail(`authenticated scrape returned ${scrape.status}`)
    return
  }

  const body = await scrape.text()

  // Registered instruments advertise themselves in `# TYPE` headers even with
  // zero observations, so presence is checkable without generating traffic.
  for (const series of REQUIRED_SERIES) {
    if (body.includes(`# TYPE ${series} `)) {
      pass(`exports ${series}`)
    } else {
      fail(`missing series: ${series}`)
    }
  }

  // Grafana Cloud's scraper authenticates with Basic auth (token as the
  // password); losing that path would break the real dashboard while Bearer
  // kept working, so both are probed.
  const basic = Buffer.from(`metrics:${TOKEN}`).toString("base64")
  const viaBasic = await fetch(`${BASE}/api/metrics`, {
    headers: { authorization: `Basic ${basic}` },
  })
  if (viaBasic.status === 200) {
    pass("Basic auth (Grafana-style) accepted")
  } else {
    fail(`Basic auth returned ${viaBasic.status}`)
  }
}

main()
  .catch((error) => fail(`probe crashed: ${error?.message ?? error}`))
  .finally(() => {
    if (failures > 0) {
      console.error(`\nmetrics probe: ${failures} failure(s)`)
      process.exit(1)
    }
    console.log("\nmetrics probe: all checks passed")
  })
