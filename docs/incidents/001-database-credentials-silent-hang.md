# Incident 001 — database credentials rotated under the running app

**Date:** 2026-09-04 · **Kind:** planned game day, real production instance
(Render free tier + Neon) · **User-facing outage:** 6 min 09 s ·
**Automatic detection:** none · **Recovery after fix:** 53 s

## Summary

The database password was rotated while the app was running. Every user who
tried to enter a room from that moment got a socket that opened and then
never answered — no error, no close, an endless loading state. The server
logged the cause on the first failed join, but nothing turned that log line
into a metric, so none of the three alerts fired. The outage ended 53 seconds
after the new password was saved in Render.

A first attempt, saving a wrong password in Render, did **not** cause an
outage: migrations run at start-up, the new copy failed to boot, and Render's
health check kept the old copy serving. That safety net is worth keeping and
is recorded here so nobody removes it.

## Timeline (America/Los_Angeles, 2026-09-04)

| Time     | Event                                                                                                                        | Source                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 14:26:00 | Wrong `POSTGRES_PASSWORD` saved in Render. New deploy fails at migration. Old copy keeps serving. **No user impact.**         | Render "deploy failed" email, 14:26      |
| 14:35:51 | Corrected deploy goes live. Process restarts; the three connected test users are dropped.                                    | metrics recorder (counters reset)        |
| 14:38:00 | Neon password for `neondb_owner` reset. The running app now holds a dead credential.                                         | operator                                 |
| 14:38:43 | First join attempts fail: `failed to add client to room … password authentication failed`. Three log lines, one per client.  | Render logs                              |
| 14:38:44 | Test clients report "connected 0/3". Users cannot enter the room.                                                            | load-test harness                        |
| 14:39:57 | Manual probe: socket opens, server logs the same error, **client observes no close and no message for 20 s.**                | probe script + Render logs               |
| 14:40:00 | Outage confirmed — by a human with a script, not by an alert.                                                                | operator                                 |
| 14:44:00 | New password saved in Render.                                                                                                | operator                                 |
| 14:44:32 | New process logs `server listening`.                                                                                         | Render logs                              |
| 14:44:39 | Old process receives SIGTERM, drains, exits.                                                                                 | Render logs                              |
| 14:44:53 | First successful join (`ready` after 457 ms).                                                                                | recovery watcher                         |
| 14:46:20 | Three test users back in the room: 136 saves flushed, 0 failures, draw fan-out p95 67 ms.                                    | load-test harness + metrics              |

## What users experienced

Room entry hung forever. Drawing was impossible because the client never
reached the `ready` state, so nothing was ever buffered for saving. The
whiteboard looked "loading", not "broken".

## What the monitoring saw

Nothing actionable.

- `ws_connections_active` blipped up and back down as clients gave up.
- `ws_messages_received_total` stayed flat.
- `event_flush_failures_total` stayed at **0** — the counter the "Save
  failures" alert watches — because no client ever got far enough to draw.
- `/api/health` answered 200 throughout. It does not touch the database, by
  design, so Render never restarted the process either.
- The "App unreachable" and "Broadcast SLO burn" rules had nothing to see.

The only place the outage was visible was the structured log stream: one
`error`-level line per failed join, with the exact Postgres message.

## Why the client hung

`backend/src/sockets/index.ts` wraps the join in a promise chain whose
`catch` logs `failed to add client to room` and calls
`ws.close(1011, "Failed to join room")`. The log line was written. The probe
never observed the close. Whether the close was sent and lost, or never sent,
is **not yet established** — it is the first thing to reproduce locally
(`POSTGRES_PASSWORD=wrong docker compose up`, connect, watch for the close
frame). Until then, treat "client hangs on join when the database is down" as
the observed behaviour.

## What worked

- The migration-at-boot gate: a bad credential cannot reach production
  through a deploy. Render's health check kept the good copy serving.
- Structured JSON logging: the cause was in the logs, with the Postgres
  error text, at the second it happened.
- Recovery was fast once the fix was saved: 53 s to first successful join.

## Action items

1. **Make a failed join visible to the user.** Confirm the 1011 close reaches
   the client; add a join timeout (e.g. 10 s) that closes with a clear reason
   if room load has not completed. Test: `POSTGRES_PASSWORD=wrong`, connect,
   expect a close frame within the timeout.
2. **Count it.** Add `room_join_failures_total{reason}` next to the log line,
   and an alert `increase(room_join_failures_total[5m]) > 0`. This is the
   metric that would have fired at 14:38:43.
3. **A readiness signal that touches the database.** Either a `/api/ready`
   that runs `SELECT 1` (kept separate from `/api/health` so Render does not
   restart a process that could recover on its own), or a gauge
   `db_reachable` refreshed every 30 s, with an alert on it.
4. **Keep** the migration-at-boot behaviour and the health/readiness split.
   Record why in the README so they survive a refactor.

## Measurements kept

Raw 5-second samples: `incidentA.csv` in the game-day scratch folder (not
committed). Load-test summaries and the Render log excerpt are quoted above.
