# Incident 002 — one machine floods a room; the instance dies in 10 s

**Date:** 2026-09-04 · **Kind:** planned game day, real production instance
(Render free tier: shared CPU, 512 MB) · **Outage:** ~10 s crash-restart, all
connected users dropped · **Automatic detection:** none · **Capacity found:**
10 flooding clients survive, 15 do not

## Summary

Thirty-six clients from one machine tried to join one room and draw 50
strokes a second each. Fifteen got in. Within ten seconds the process was
gone, Render answered 503, and a fresh process came up with every counter at
zero — including the two well-behaved users who were in the room first. No
Grafana alert fired: a ten-second crash is shorter than every alert's pending
period. Render's own "Server failure detected" email arrived within the
minute, and was the only notification.

The process did not die of load directly. It died of an **unhandled promise
rejection** when a database connection attempt timed out under that load —
see "Cause of death" below.

A follow-up ramp found the knee: 5 flooders are absorbed, 10 are absorbed but
users feel it (draw fan-out p95 goes from 79 ms to 209 ms), 15 crash it.

The most important finding is about measurement, not capacity: **the SLO
metric never moved.** Server-side broadcast p95 read 0.2 ms while real
clients measured 209 ms. The histogram times the fan-out loop only; the
queueing that users actually feel shows up in event-loop lag instead.

## Timeline (America/Los_Angeles, 2026-09-04)

| Time     | Event                                                                                                         | Source                     |
| -------- | ------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 14:54:13 | Two normal clients join room `gameday-b` (1 stroke per 500 ms). Event-loop lag 10 ms.                         | metrics recorder           |
| 14:54:25 | 36 flooders launched, 25 ms apart, 1 stroke per 20 ms each. **15 connect, 21 time out.**                      | load-test harness          |
| 14:54:30 | 17 sockets open. Event-loop lag p50 **306 ms**. Server broadcast p95 2.3 ms. Rate limiter and drop counters 0. | metrics recorder           |
| 14:54:3x | Unhandled rejection in `sendCheckpoints` (database connect `ETIMEDOUT`). **Node exits.**                      | Render logs (fatal dump)   |
| 14:54:35 | Render answers **503** for `/api/metrics`. Process gone.                                                       | metrics recorder           |
| 14:54:37 | New process logs `server listening`.                                                                          | Render logs                |
| 14:54:40 | Fresh process: all counters 0, RSS 74 MB. Every client dropped, normal users included.                        | metrics recorder           |
| 14:54    | Render emails "Server failure detected on online-whiteboard". The only notification anyone received.         | operator's inbox           |
| 14:55:59 | Ramp level 5, new room, 60 s: absorbed. Client fan-out p95 79 ms, ping p95 82 ms.                             | load-test harness          |
| 14:57:21 | Ramp level 10, 60 s: absorbed but degraded. Fan-out p95 **209 ms**, p99 477 ms, ping p95 243 ms.              | load-test harness          |
| 14:58:24 | During level 10: server broadcast p95 **0.2 ms**, event-loop lag p50 **112 ms**.                              | metrics recorder           |
| 14:58:29 | Level 10 ends; final buffered flush p95 spikes to 900 ms, then quiet.                                         | metrics recorder           |

### Cause of death

Not memory and not a health check. The Render log at 14:54:3x ends with a
Node fatal-error dump (`Node.js v22.23.2`) whose stack is
`RoomManager.checkpointList` failing with an `AggregateError`: every attempt
to open a new Postgres connection to Neon (three IPv4 addresses, three IPv6)
ended in `connect ETIMEDOUT` / `ENETUNREACH`. That rejection was never
caught, and an unhandled promise rejection terminates a Node process.

The chain:

1. Fifteen new sockets joined at once. Each join calls
   `void this.sendCheckpoints(socket, room)` (`roomManager/index.ts:344`) —
   fire-and-forget, **no `catch`** — which awaits `listCheckpoints` and
   therefore a pooled database connection.
2. The pool needed fresh connections for the burst. With the event loop at
   306 ms lag and the instance's shared CPU saturated, the TCP connects to
   Neon did not complete before Node's connect timeout and failed as
   `ETIMEDOUT`.
3. `pg-pool` surfaced the failure as a rejected promise inside
   `sendCheckpoints`. Nothing handled it. Node exited.
4. Render restarted the process (`server listening` at 14:54:37.473) and
   emailed **"Server failure detected on online-whiteboard"** at 14:54.

So the flood was the trigger, but the kill shot was an unguarded background
promise: any database connect timeout during a join, flood or not, takes the
whole instance down. There is no `process.on("unhandledRejection")` handler
in the backend, and `db/pool.ts` sets no `connectionTimeoutMillis`, so a
stalled connect is left to the OS timeout.

## Numbers

| Flooders (1 stroke / 20 ms each) | Msgs/s into server (approx.) | Client fan-out p95 | Client ping p95 | Server broadcast p95 | Event-loop lag p50 | Outcome        |
| -------------------------------- | ---------------------------- | ------------------ | --------------- | -------------------- | ------------------ | -------------- |
| 0 (baseline, 3 normal drawers)   | 6                            | 66 ms              | 64 ms           | 0.5 ms               | 10 ms              | normal         |
| 5                                | 250                          | 79 ms              | 82 ms           | 0.2–0.6 ms           | 10 ms              | absorbed       |
| 10                               | 500                          | 209 ms             | 243 ms          | 0.2 ms               | 112 ms             | degraded       |
| 15 (+2 normal)                   | 750                          | —                  | —               | 2.3 ms               | 306 ms             | crash in ~10 s |

Baseline for the instance: RSS 42 MB idle, 0 users; 48 MB with 3 drawers.

## What the monitoring saw

- **Broadcast SLO burn** (server p95 > 50 ms for 5 min): never close. The
  server-side histogram measures the fan-out loop, which is fast even when
  the process is starving; it does not include time spent waiting in the
  event-loop queue. It is blind to exactly the degradation users feel.
- **App unreachable** (5 min pending): one 503 sample, then healthy. Never
  fires on a crash-restart.
- **Save failures:** 0 throughout.
- The signals that *did* move: `nodejs_eventloop_lag_p50_seconds` (10 → 112
  → 306 ms) and, after the restart, every counter resetting to zero.
- The per-socket token bucket (200 units/s sustained, 600 burst) and the
  backpressure drop counter never tripped. Fifty pencil strokes a second per
  socket sits inside the budget, so the limiter admitted the load that killed
  the process.

## What worked

- Render restarted the process in about five seconds; recovery needed no
  human.
- 5 flooders at 250 msgs/s cost users nothing measurable.
- The per-IP cap (32) and the connect path shed 21 of 36 sockets — though by
  timing out under load rather than by refusing them, so `ws_upgrades_rejected_total`
  stayed at 0 and the shedding was invisible.

## Action items

0. **Never let a background promise kill the process.** Give
   `sendCheckpoints` (and every other `void this.…(…)` call in the room
   manager) a `catch` that logs and, where it makes sense, tells the client.
   Add a `process.on("unhandledRejection")` handler that logs with the
   stack and keeps the process alive, so the next one of these is an error
   line instead of an outage. Set `connectionTimeoutMillis` on the pool so a
   stalled connect fails fast and predictably. Test: block the database
   address, join a room, expect one logged error and a live process.
1. **Alert on restarts.** `changes(process_start_time_seconds[15m]) > 0`,
   pending 0 s. This is the one rule that would have fired in both incidents
   of this game day.
2. **Alert on event-loop lag.** `nodejs_eventloop_lag_p50_seconds > 0.1` for
   2 min. It moved a full minute before users felt the degradation at level
   10, and 5 s before the crash at level 15.
3. **Fix the SLI.** Either time a broadcast from *message receipt* to *last
   send completed* (queueing included), or adopt event-loop lag as the SLI
   and re-state the SLO in terms users can feel. The current
   `ws_broadcast_duration_seconds` should be relabelled as what it is: the
   fan-out loop cost.
4. **Budget the room, not just the socket.** A per-room aggregate message
   budget (or a lower per-socket ceiling for pencil strokes) so that ten
   sockets cannot spend more CPU than the instance has. Target: level 15
   degrades instead of dying.
5. **Count shed connections.** A connection that times out under load should
   increment a counter, so shedding is visible.
6. **Record the capacity.** On this instance class: ≤ 250 msgs/s is free,
   500 msgs/s is degraded, 750 msgs/s is fatal. Re-measure after item 4.

## Follow-up

- **2026-09-04, item 0 landed** (same day, uncommitted at time of writing):
  `sendCheckpoints` now catches and logs; `server.ts` registers an
  `unhandledRejection` handler that logs the stack and keeps the process
  alive; `db/pool.ts` sets `connectionTimeoutMillis` (default 5000 ms,
  `PG_CONNECT_TIMEOUT_MS` to override). An audit of the other twelve
  `void this.…()` sites in the room manager found each already carries its
  own `try/catch`; `sendCheckpoints` was the only gap. Pinned by
  `backend/src/sockets/__tests__/sendCheckpoints.test.ts` and
  `backend/src/db/__tests__/poolConfig.test.ts`. Items 1–6 remain open; the
  level-15 flood should be re-run after deploy to record the after number.

## Measurements kept

Raw 5-second samples: `incidentB.csv`; harness output: `floodB.log`,
`canaryB.log`, `rampB.log` (game-day scratch folder, not committed). Client
numbers are from the harness's own per-message timing across all clients in
the room.
