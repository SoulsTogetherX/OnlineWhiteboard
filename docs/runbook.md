# Runbook — when an alert fires

Production is one Render web service (free tier, single instance) in front
of a Neon Postgres database. Metrics are scraped from `/api/metrics` (token in
`METRICS_TOKEN`) by Grafana Cloud; logs are structured JSON in Render's Logs
tab. Written after the 2026-09-04 game day (`docs/incidents/001`, `002`).

First move for every alert: open Render → Logs and read the last two minutes.
The server logs every failed join, flush failure and shutdown with a reason.

## App unreachable (`up == 0` for 5 min)

**Means:** Grafana could not scrape the metrics page for five minutes.

1. Open the app URL in a browser. If it loads, the app is up and the scrape is
   the problem: check `METRICS_TOKEN` in Render matches the password in the
   Grafana scrape job (a token change is the usual cause).
2. If it does not load: Render → Events. A failed deploy means the old copy
   should still be serving; a crash loop shows repeated restarts.
3. Free-tier hours exhausted also looks like this. Render emails about it.

**Confirm fixed:** `up` returns to 1; a manual join gets `ready`.

## Save failures (`increase(event_flush_failures_total[10m]) > 0`)

**Means:** drawing works, but the room's events are not reaching Postgres.
Users will lose work on restart.

1. Render → Logs: look for `flush failed` lines with the Postgres error.
2. `password authentication failed` → the Neon password changed. Paste the
   current one into `POSTGRES_PASSWORD` in Render and save (this redeploys).
3. Connection refused / timeout → check Neon's status page and the project's
   compute state (a suspended compute wakes on first query; a deleted branch
   does not).
4. **Note from incident 001:** if the database went away *before* users
   joined, this alert will not fire at all — the symptom is users hanging on
   room entry. Check the logs for `failed to add client to room`.

**Confirm fixed:** the counter stops rising; a test drawer's strokes survive a
page reload.

## Broadcast SLO burn (server p95 > 50 ms for 5 min)

**Means:** the fan-out loop itself is slow. Rare; see incident 002 — this
metric stayed fast while users were suffering, so its silence is not
reassurance.

1. Look at `nodejs_eventloop_lag_p50_seconds` first. Above 100 ms the process
   is CPU-starved regardless of what this histogram says.
2. Check `ws_connections_active` and `ws_messages_received_total` rate. One
   room taking hundreds of messages a second from a handful of sockets is a
   flood; the per-socket limiter admits it (incident 002).
3. Mitigation today: nothing automatic. Restarting the service drops every
   socket, including the flooder's; it will reconnect if it is a script.

**Confirm fixed:** lag back near 10 ms, client-side fan-out (run
`loadtest` with 2 clients) p95 under 100 ms.

## Process restarted (`changes(process_start_time_seconds[15m]) > 0`) — to be added

**Means:** the process died or was redeployed. If no deploy happened
(Render → Events), it crashed.

Render also emails "Server failure detected on <service>" within a minute of
a crash; until this alert exists, that email is the signal.

1. Render → Logs at the restart time: `Out of memory`, an uncaught exception
   or unhandled rejection (a stack trace ending in `Node.js vXX`), or a
   health-check timeout (`Detected service running` after a gap). Incident
   002 was an unhandled rejection from a database connect timeout.
2. Correlate with `nodejs_eventloop_lag_p50_seconds` and
   `ws_messages_received_total` in the minute before: a spike means load
   (incident 002).
3. Every connected user was dropped; the canvas is safe if the last flush
   succeeded (see Save failures).

## Users report "stuck loading" but no alert fired

This is incident 001. The database is unreachable and joins hang.

1. Render → Logs: `failed to add client to room` with the Postgres error.
2. Fix the credential or the database as under Save failures.
3. Until action item 001-2 lands (a join-failure counter), only the logs
   show this.

## Game-day tooling

- `loadtest/` — `npm run run -- --url wss://<host>/ws --room <r> --clients N --drawerRatio 1 --drawIntervalMs 500 --durationMs 60000`
  for a normal-user canary; `--drawIntervalMs 20` for a flood. The per-IP cap
  is 32 sockets; the shared-CPU instance dies around 15 flooders at 20 ms.
- A single-socket probe that waits for `ready` is the fastest "is it really
  up" check; keep one in a scratch folder.
