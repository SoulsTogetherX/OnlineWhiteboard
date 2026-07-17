# Load Test Tool

A standalone script that opens real WebSocket connections to your running
backend and speaks the actual `draw`/`ping`/`canvas_snapshot` protocol — not
a generic HTTP load tester. It measures the things that matter for this app
specifically:

- **Connect time / connect success rate** — can new clients even join?
- **Ping RTT** — is the server's event loop keeping up under load?
- **Draw fan-out latency** — from the moment one client draws a stroke to
  the moment every *other* client in the room receives it. This is the
  number that actually represents "does collaboration feel laggy."
- **Throughput** — bytes/sec received, with the base64 canvas snapshot broken
  out separately. Each client receives one ~75KB snapshot when it joins.

> **History:** this tool was originally written to measure a periodic
> full-canvas broadcast — every client used to receive a fresh base64 copy of
> the whole canvas every 10 seconds, an `O(clients × 75KB)` cost per room that
> was paid whether or not anyone was drawing. That was the harness's headline
> finding, and it is **fixed**: the server now broadcasts a tiny
> `revision_check` (a few dozen bytes) on that interval instead, and only a
> client that has actually fallen behind asks for a snapshot via `resync`.
> The old finding no longer reproduces.

### Known gaps

- **The `resync` path is not exercised.** This harness ignores `revision_check`
  and never sends `resync`, so it never triggers the one remaining place a
  75KB snapshot is sent on demand.
- **Coordinated omission.** Every simulated client shares one Node event loop,
  so at high client counts the harness itself saturates: `setInterval` fires
  late, it under-sends, and it under-reports latency. Treat large-N runs as
  optimistic. There is no event-loop-lag self-monitoring.
- **No warmup discard.** Drawers connect first and start drawing immediately,
  so the ramp-up window is measured against a partially-populated room.
- **Always exits 0**, even after a ramp fail-fast — not usable as a CI gate
  as-is.

It does **not** measure server CPU/memory itself — run `docker stats` in
another terminal (local) or watch your host's metrics dashboard (Render,
etc.) alongside a test run for that half of the picture.

## Setup

```bash
cd loadtest
npm install
```

Make sure the backend is actually running first (`docker compose up`, or
`npm run start` inside `backend/` if you're testing a deployed instance).

## Single scenario

```bash
npm run run -- --clients 50 --room demo --durationMs 30000
```

Connects 50 clients to room `demo`, holds them open for 30s (a fraction of
them — see `--drawerRatio` — actively "draw" random strokes the whole
time), then prints a summary.

Common flags (all optional, shown with defaults):

| flag | default | meaning |
|---|---|---|
| `--url` | `ws://localhost:3000/ws` | backend WS endpoint. Use `wss://your-app.onrender.com/ws` for a deployed instance |
| `--room` | `loadtest-<timestamp>` | room id to join |
| `--clients` | `50` | number of simulated clients |
| `--drawerRatio` | `0.2` | fraction of clients that actively draw (rest just idle + ping, like real viewers) |
| `--drawIntervalMs` | `200` | how often each drawer sends a stroke |
| `--pingIntervalMs` | `1000` | how often every client pings for RTT |
| `--connectStaggerMs` | `10` | delay between connection attempts (avoids a simultaneous connect-storm skewing results) |
| `--durationMs` | `30000` | how long to hold the test open once connected |

## Capacity ramp (the "how many clients can it support" answer)

```bash
npm run ramp -- --room demo --levels 5,10,25,50,100,200,400
```

Runs the scenario above at each client count in sequence, in the *same*
room by default, and writes `loadtest-results.csv` after every level (so
you keep partial results even if it stops early). It stops automatically
if:

- more than 10% of connection attempts fail at a level (`--failFastConnectRate`), or
- p95 ping RTT exceeds 3000ms (`--failFastPingMs`)

— i.e. it finds the knee in the curve for you rather than you guessing at
a number to try.

Pass `--sameRoom false` to instead spread each level across a fresh room
(`demo-L5`, `demo-L10`, ...) — that isolates *total server capacity*
(many rooms in parallel) from *single-room fan-out capacity* (one room
absorbing all the broadcast cost), which are genuinely different limits in
this architecture: broadcasts only fan out within a room, so 10 rooms of
50 clients each is cheaper for the server than 1 room of 500.

## Interpreting results for your writeup

- **Fan-out latency growing with client count in one room, but flat across
  many small rooms** — confirms the bottleneck is the per-room broadcast
  fan-out (`room.clients.forEach(...)` in `roomManager`), not raw server
  throughput. That's a legitimate, explainable architectural finding, not
  a bug.
- **Ping RTT spiking specifically every ~10s** — this *used to* be the periodic
  full-canvas snapshot broadcast saturating the event loop. It should no longer
  happen: `SNAPSHOT_INTERVAL_MS` in `roomManager/index.ts` now fires
  `broadcastRevisionCheck`, which sends a few dozen bytes per client instead of
  ~75KB. If you still see a 10s sawtooth, something has regressed — that is now
  a bug report, not an expected finding.
- **Connect time rising before connect failures start** — you're seeing
  queueing before you're seeing outright rejection; that's your realistic
  "gets sluggish" threshold, distinct from the hard capacity ceiling.

A simple `clients` (x-axis) vs `p95 draw fan-out latency` (y-axis) chart
from the CSV is a good centerpiece for a portfolio writeup — happy to help
build that chart from your results once you've run it.
