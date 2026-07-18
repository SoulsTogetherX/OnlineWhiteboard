# OnlineWhiteboard — Architecture & Working Notes

> Context document for working on this repo, human or AI. Lives at the repo root so
> Claude Code auto-loads it. Rewritten 2026-07-17 to describe the system as it is now.
>
> **Read §12 (Working agreements) before changing anything.**

---

## 1. What this is

A real-time collaborative **pixel** whiteboard. Users join a **room** by id, draw on a
shared **120×120 RGBA** canvas, and every stroke propagates live to everyone in that room.
Canvas state survives disconnects, restarts and hard crashes.

The defining architectural decision: **the server owns an authoritative pixel buffer**,
not a list of shapes. Everything else follows from that.

Feature surface today: freehand pencil/eraser, flood-fill bucket, spray can, adjustable
brush size, concurrency-safe undo/redo, live presence + cursors, optional accounts,
per-room roles, consensus-gated board clearing, named checkpoints with restore, history
playback, a "My Rooms" dashboard with thumbnails, and a saved colour palette.

---

## 2. Tech stack

| Layer         | Choice                             | Notes                                        |
| ------------- | ---------------------------------- | -------------------------------------------- |
| Frontend      | React 19 + Vite 8                  | No router, no state library, no CSS framework |
| Backend       | Express 5 + `ws` 8                 | Raw `ws`, **not** Socket.IO                   |
| Database      | PostgreSQL 18-alpine               | Accessed via **Kysely** (typed query builder) |
| Schema        | Ordered SQL migrations             | `backend/src/db/migrations/00N_*.ts`, run at startup |
| Language      | TypeScript                         | FE `~6.0`, BE `^5.8` — different per package  |
| Runtime       | Node 22 (all images, CI, `@types/node`) | Kept aligned on purpose — see §11        |
| Dev runner    | `tsx watch` (BE), `vite` (FE)      | Backend is never compiled in dev              |
| Prod          | Multi-stage Docker → nginx + esbuild bundle | `docker-compose.prod.yaml`           |
| Tests         | Vitest (3 suites)                  | See §11                                       |
| CI            | GitHub Actions                     | Verify job + full prod-stack e2e              |

---

## 3. Repository layout

```
OnlineWhiteboard/
├── CLAUDE.md                 # this document
├── .githooks/pre-commit      # the verification gate (§12)
├── docker-compose.yaml       # DEV stack (Vite HMR + tsx watch)
├── docker-compose.prod.yaml  # PROD stack (nginx + compiled backend)
├── .env / .env.example       # ALL ports, hostnames, credentials, origins
├── frontend/                 # React + Vite SPA
│   ├── vite.config.ts        # aliases + DEV proxy — read this first
│   ├── nginx.conf.template   # PROD proxy — must mirror vite.config.ts
│   └── src/{app,components,hooks,utils,constants}
├── backend/                  # Express + ws
│   └── src/
│       ├── server.ts         # entry: express + http + WebSocketServer + shutdown
│       ├── sockets/          # upgrade gate + roomManager (★ the heart)
│       ├── db/               # pool, schema, migrations, repositories
│       ├── auth/             # password, session, identity, requireUser
│       ├── routes/           # auth, colors, rooms, health
│       └── security/         # origin, csrf, rateLimit
├── shared/                   # ★ imported by BOTH frontend and backend
│   ├── types/                # protocol + identity contracts
│   ├── constants/canvas/     # dimensions, brush + spray caps
│   └── utils/                # the draw algorithms — run on BOTH sides
├── database/                 # stock Postgres image (schema lives in migrations)
├── loadtest/                 # standalone ws load harness
└── scripts/smoke-test.mjs    # dependency-free prod-stack probe (used by CI)
```

---

## 4. `shared/` — the most important idea in the repo

`shared/utils/*` contains the **pixel-mutation algorithms** (Bresenham line, flood fill,
seeded spray, compare-and-swap patch). Both the browser and the Node server import and
execute the *same source file*. That is why the server can maintain an authoritative canvas
provably identical to what clients render — there is one implementation, not two kept in
sync by discipline.

**This is the single strongest talking point in the codebase.**

### How it is wired — three separate mechanisms, know all three

1. **Frontend build**: `vite.config.ts` → `resolve.alias["@shared"] = ../shared`
2. **Type checking**: `tsconfig.app.json` / `backend/tsconfig.json` → `paths: {"@shared/*": ["../shared/*"]}`
3. **Backend runtime**: `tsx` reads `paths` from `backend/tsconfig.json`; prod bundles via esbuild

`shared/` is **not** an npm package — no `package.json`, no workspaces. It is joined purely
by path aliases. In Docker this works because both containers use `WORKDIR /app` and compose
mounts `./shared:/shared`, so `../shared` resolves.

> ### ⚠️ `shared/` has NO build boundary
>
> A change under `shared/` hits frontend, backend **and** loadtest simultaneously, with
> nothing to stop you. This is the repo's most important operational fact — the pre-commit
> hook encodes it by re-verifying every consumer whenever `shared/` is touched.

### What belongs in `shared/`

Anything both sides must agree on: the wire protocol types, the pixel algorithms, canvas
dimensions and abuse caps, instruction validation, colour equality, the role list and the
authorisation helpers. If the client and server could ever disagree about it, it goes here.

---

## 5. Runtime — how it actually works

### 5.1 Joining a room

```
Browser                                   Server
  |-- GET /ws?roomId=X (HTTP Upgrade) ---->|  sockets/index.ts
  |                                        |  reject unless pathname==="/ws"
  |                                        |  reject disallowed Origin (CSWSH, §9)
  |                                        |  reject missing roomId
  |<---------- 101 Switching --------------|
  |                                        |  resolveConnectionIdentity(cookie)
  |                                        |    -> account identity, or generated guest
  |                                        |  ensureMembership -> role for this room
  |                                        |  getOrCreateRoom: cache hit, else
  |                                        |    latest snapshot + replay newer events
  |<-- {ready, revision, self, participants}
  |<-- {canvas_snapshot, data: base64 57600B -> 76800 chars}
  |<-- {checkpoints, ...}
  |<-- {presence, participants}   (broadcast to the room)
```

Messages that arrive **before** the room finishes loading are buffered (capped at
`MAX_PENDING_MESSAGES = 64`) and drained in order — see §13.1, this is load-bearing.

### 5.2 Drawing

Client paints **optimistically** (locally, before the server confirms), then sends a
`DrawInstruction`. The server applies it to its buffer via the same shared function,
bumps `revision`, appends to the event log, and broadcasts to **everyone including the
sender**. Re-applying your own stroke is idempotent (same pixels, same colour).

Tools: `pencil`, `eraser`, `bucket`, `spray`. Plus `patch` (undo/redo, never from the
toolbar) and `clear` (server-generated only, never accepted from a client).

**The spray can is worth understanding**: the instruction carries a `seed`, not a pixel
list. `shared/utils/random.ts` (mulberry32) reproduces the identical splatter on the server
and every client. `Math.random()` could not be used inside the apply path — it isn't
seedable, so two clients would paint different splatters and desync. Choosing the seed with
`Math.random()` on the client is fine; only the *value* travels.

**Brush size** is a diameter, stamped as a filled disc along the Bresenham path
(`forEachDiscPixel`), deduped per stroke so undo entries stay proportional to area painted
rather than stroke-length × brush-area.

### 5.3 The revision heartbeat — the best perf story here

Every 10s the server broadcasts `{revision_check, revision}` — a few dozen bytes. Each
client compares it to its own last-applied revision; only a client that has **fallen
behind** sends `{resync}`, and only that client receives a fresh ~75KB snapshot.

This replaced an older design that broadcast the whole canvas to everyone every 10s:
O(clients × 75KB) → O(clients × ~40B), and the cost no longer grows with canvas size.

### 5.4 Undo/redo — compare-and-swap patches

The most sophisticated part of the codebase.

- While drawing, `withRecording()` wraps the pixel setter so every write also records
  `{idx, from, to}` — the undo entry is built **for free** off the same loop that paints.
- Undo reverses the entries (`from`↔`to`) and sends a `PatchInstruction`.
- `handleDrawPatchInstruction` applies each entry **only if the pixel currently equals
  `from`**. Anything a collaborator painted over is skipped.
- The applied *subset* is returned, so the server broadcasts only what really landed and
  the client stacks only what really landed — and tells the user when an undo applied
  partially.

Naive undo in a collaborative app clobbers other people's work. This makes undo safe under
concurrency **without full OT/CRDT machinery**. Second-strongest talking point.

Stack caps are dual: `MAX_ACTIONS = 50` **or** `MAX_BYTES = 64KB`, whichever hits first —
a long scribble is many actions/few entries, a bucket fill is one action/many entries.
Neither cap alone bounds both shapes.

### 5.5 Identity, presence and cursors

Every connection gets an identity at upgrade time: a logged-in user (from the session
cookie) or a generated guest. `connectionId` is **per socket** — the same account in two
tabs is two participants.

`Participant` deliberately carries **no account id**: it is broadcast to everyone in the
room, and a stable per-account identifier would let anyone correlate a user across rooms.

Cursors are a separate ephemeral `cursor` message: relayed to others, **never** applied to
the canvas, never logged, never persisted. Client-side they live in a **ref** (mutated many
times a second, no re-render) with a separate `cursorIds` state that only changes when a
cursor appears or disappears. `CursorOverlay` positions them in a rAF loop.

### 5.6 Roles and authorisation

`ConnectionRole = "owner" | "editor" | "viewer" | "guest"`.

The rules live once, in `shared/types/identity.ts`, and **both sides call them**:

| Helper             | Allows                                    | Who              |
| ------------------ | ----------------------------------------- | ---------------- |
| `canDraw`          | drawing, initiating/voting on actions     | everyone but `viewer` |
| `hasEditAuthority` | create/restore/delete checkpoints         | `owner`, `editor` |
| `canManageRoom`    | change roles, remove members              | `owner` only     |

The server is the authority; client checks are cosmetic (greying out controls). A crafted
client cannot bypass them — `RoomManager` re-checks on every message.

Membership: first registered user into a fresh room claims **owner**, everyone after is
**editor**; guests are never members. A room has **exactly one owner**, enforced
structurally (§13.4).

### 5.7 Destructive actions need consensus

Clearing the board is not a draw instruction a client may send — the server **rejects** a
client-originated `clear`. The only path is `request_action`:

- Voters = currently-connected **recent editors** (drew within `RECENT_EDITOR_WINDOW_MS`
  = 15 min), plus the requester.
- Only one vote per room at a time. Requires **unanimous** approval; any rejection kills it.
- Auto-fails after `VOTE_TIMEOUT_MS` = 30s so one AFK voter can't freeze the board.
- If the requester is the only recent editor, it applies immediately.
- On resolution the server applies a `ClearInstruction` itself, which then flows through
  the normal event-log + broadcast path like any other instruction.

### 5.8 Checkpoints and playback (time travel)

- **Checkpoint** = a named, durable full-canvas snapshot at a revision. Editors only.
  Capped at **20 per room**; pixels are captured synchronously before any await so the
  stored bytes and revision can't disagree.
- **Restore** sets the live pixels, bumps the revision, persists, and broadcasts a fresh
  snapshot to everyone. It is *not* logged as an instruction — the new snapshot **is** the
  state, and recovery reads the latest snapshot.
- **Playback** is read-only, so anyone (including viewers) may watch. The server sends a
  base canvas + the ordered events after it; the client animates by applying them.

Checkpoints interact with compaction: `saveRoom` keeps events newer than the **oldest
checkpoint** so history stays replayable from it.

---

## 6. Persistence and durability

Data model: `rooms` + `canvas_snapshots` + `draw_events` (+ `users`, `sessions`,
`saved_colors`, `room_members`, `checkpoints`).

**Event sourcing is what makes data loss sub-second.** Every applied instruction is appended
to `draw_events`, flushed in batches every `FLUSH_INTERVAL_MS = 250ms` (or early past
`MAX_EVENT_BUFFER = 200`). Recovery = latest snapshot + replay every event with a greater
revision, through the **same** `applyDrawInstructionToCanvas` the live path and unit tests
use.

| Mechanism            | Interval | Purpose                                          |
| -------------------- | -------- | ------------------------------------------------ |
| Event flush          | 250 ms   | Durability floor — bounds hard-crash loss        |
| Snapshot / save      | 15 s     | Recovery base; also compacts the log             |
| `revision_check`     | 10 s     | Cheap sync heartbeat (§5.3)                      |
| ws ping              | 30 s     | Dead-socket reaping                              |
| Stale-room + session sweep | 24 h | Bounds the only unbounded tables (90-day room retention) |

**Compaction**: writing a snapshot also deletes the `draw_events` it supersedes, in the
**same transaction** — so events are only trimmed once their replacement is committed.

**Graceful shutdown**: `SIGTERM`/`SIGINT` → flush every room's buffer + write a final
snapshot before exit. Works only because the Dockerfile runs `node` as PID 1, not `npm`.
A normal deploy therefore loses **nothing**; a hard `docker kill` loses at most ~250 ms.

---

## 7. Auth

Optional accounts — the app is fully usable as a guest.

- **Passwords**: scrypt (salted, memory-hard) via built-in `node:crypto` — no native
  dependency, Alpine-safe. The password itself is never stored.
- **Sessions**: server-side. The cookie holds a random token; the DB stores only its
  **SHA-256 hash**, so a database leak can't be replayed as live logins. `httpOnly`,
  `SameSite=Lax`, `Secure` in prod, `__Host-sid` name in prod.
- **Login** uses a generic error + constant-work path so it cannot leak which emails exist.
- Logging in/out **reconnects the socket** (via `reconnectKey`) so the server re-resolves
  identity without a page reload.

---

## 8. Security posture

| Threat | Defence |
| --- | --- |
| CSWSH (cross-site WebSocket hijacking) | Origin allowlist checked at the upgrade, before it becomes a socket. `SameSite` does **not** reliably cover WS upgrades — this is the primary defence. |
| CSRF | `csrfOriginGuard` on state-changing API requests, on top of `SameSite=Lax`. |
| Credential stuffing | Per-IP rate limits: login **10 / 15 min**, register **5 / 60 min** (keyed off nginx's `X-Real-IP`). In-memory, so per-process — multi-instance needs Redis. |
| Weak passwords | Common-password blocklist in `auth/validation.ts`. |
| Deanonymisation | `Participant` carries no account id (§5.5). |
| Malicious instructions | `shared/utils/validateInstruction.ts` at the single fan-in point (§13.2). |
| Clickjacking / sniffing / TLS downgrade | `security-headers.conf`: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy. |

**Origin allowlist fails OPEN in development, CLOSED in production.** If `ALLOWED_ORIGINS`
(or `PUBLIC_SITE_URL`) is unset, dev still runs — a check that blocks local work gets
deleted — but production **refuses** browser requests and logs at error level. A security
control that silently switches itself off when misconfigured is worse than one that breaks
loudly. Requests with **no** Origin (health probes, the smoke test, curl) are always allowed;
they can't carry a victim's cookie.

> `nginx add_header` inheritance trap: a `location` with its own `add_header` drops **all**
> inherited ones. That's why `security-headers.conf` is `include`d in the server block *and*
> in the cache locations. CSP needs `style-src 'unsafe-inline'` for the app's inline
> `style={{}}`; scripts stay `'self'`.

---

## 9. Running it

```bash
# DEV — Vite HMR + tsx watch.  http://localhost:5173
docker compose up --build
docker compose logs -f frontend
docker compose down            # 'down -v' ALSO deletes the database volume

# PROD — nginx + compiled backend.  http://localhost:8080
docker compose -f docker-compose.prod.yaml up --build -d
docker compose -f docker-compose.prod.yaml down
```

Run **one stack at a time** — they contend for host ports and use separate DB volumes.
Dev publishes 5173/3000/5432; prod publishes **only** `PROD_PORT` (8080).

Quick prod checks:

```bash
curl http://localhost:8080/api/health                                    # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/any/route   # 200 (SPA fallback)
node scripts/smoke-test.mjs http://localhost:8080                        # full protocol probe
```

> **Windows/Git Bash:** prefix docker commands taking container paths with
> `MSYS_NO_PATHCONV=1` and use a leading `//`, or paths get mangled to `C:/Program Files/Git/...`.

### Docker specifics worth knowing

- **Postgres 18 changed `PGDATA`** to `/var/lib/postgresql/18/docker`. Both compose files
  therefore mount the **parent** `/var/lib/postgresql`. "Correcting" this to
  `/var/lib/postgresql/data` looks right, matches every pre-18 tutorial, and **silently
  persists nothing**.
- **`container_name` vs service name**: `pool.ts` dials `POSTGRES_HOST` (`postgres-c`). Dev
  gets that free from `container_name`; prod deliberately omits it (so both stacks can
  coexist) and supplies a **network alias** instead. Removing that alias breaks prod DNS.
- **Anonymous `/app/node_modules` volume** in both services masks the host's `node_modules`
  so the container keeps its own installed deps.
- **`CHOKIDAR_USEPOLLING=true`** — file-watch events don't cross the Windows/WSL2 boundary
  reliably.

---

## 10. Vite specifics

- **Dev and prod are different engines**: dev serves native ESM (no bundling); `vite build`
  uses Rollup. Something can work in dev and break in the build — always check both.
- **Aliases**: `@` → `./src`, `@shared` → `../shared`. The `@shared` alias is what makes the
  shared-protocol architecture work on the frontend.
- **`/@fs/` escape hatch**: `shared/` is *outside* the Vite root, and Vite serves it via
  `/@fs/`. This is load-bearing — tightening `server.fs.allow` or changing the root breaks
  the app instantly.
- **The dev proxy is the most load-bearing 8 lines**: `/api` and `/ws` (with `ws: true`)
  proxy to the backend, so the browser only ever talks to its own origin — no CORS, no
  hardcoded backend URL. `frontend/nginx.conf.template` re-implements exactly this for prod;
  **the two must be kept in agreement.**
- **The invariant that makes one artifact run anywhere**: the client requests a *relative*
  `/ws`, and `toWebSocketUrl` resolves it against `window.location`, upgrading
  `http:`→`ws:` / `https:`→`wss:`. Do **not** "fix" this into a `VITE_WS_URL` env var —
  that reintroduces a per-environment rebuild for no benefit.
- `vite build` does **not** typecheck. `tsc -b` is what enforces types.

---

## 11. Tests and CI

Three suites, each matched to what it is good at:

| Suite | Command | Count | Needs |
| --- | --- | --- | --- |
| Shared protocol (unit) | `npm test` (root) | **89** in 9 files | nothing |
| Frontend (unit) | `cd frontend && npm test` | **7** | nothing |
| Backend | `cd backend && npm test` | **63** (20 pure, 43 DB-gated) | Postgres for the 43 |

The shared suite is the highest-value code in the repo to test: pure, deterministic, no DOM
/ network / database, and **both sides execute it** — a bug there desynchronises every
client from the server's canvas.

The backend's DB suites gate themselves on `POSTGRES_PASSWORD` so `npm test` stays green
with no database. The pure ones (password hashing, input validation, origin allowlist) run
everywhere.

**CI** (`.github/workflows/ci.yml`) has two jobs:

1. **verify** — shared tests + typecheck, frontend typecheck + lint + tests, backend
   typecheck + integration tests against a `services: postgres` container, loadtest
   typecheck (which is what catches the harness drifting off the protocol).
2. **e2e** — builds the **production** images, brings the whole stack up with `--wait`, and
   drives it over HTTP and WebSocket via `scripts/smoke-test.mjs`. This is what proves the
   pieces agree, which unit tests cannot.

Local integration tests: a native Windows Postgres on `:5432` **shadows** the Docker one for
host connections — use a throwaway on a free port
(`docker run -p 55432:5432 postgres:18-alpine`) and point `POSTGRES_PORT` at it.

---

## 12. Working agreements — READ BEFORE CHANGING ANYTHING

These are enforced where they can be (see the gate below) and expected where they can't.

### 12.1 Verify every change — typecheck is not verification

`tsc` and `eslint` prove the code *compiles*, not that it *works*. Every feature needs
evidence it does what it claims, at the cheapest level that actually demonstrates it:

| Change | Minimum acceptable verification |
| --- | --- |
| Pure logic (`shared/`, utils, validation) | A unit test that fails before the change |
| Repository / SQL | Integration test against a real Postgres |
| Protocol change | Both sides updated + `scripts/smoke-test.mjs`, or a live socket probe |
| UI behaviour / a11y | **Drive it.** Run the app and observe the actual behaviour |
| Security control | A test asserting both the allow AND the deny path |

State in the commit message *how* it was verified, with observed values where possible.
"Typechecks" is not an answer for anything with runtime behaviour.

### 12.2 Commit after each verified feature

One concern per commit, on a feature branch, **after** it is verified. Commit messages
explain *why*, not just what — this repo's history is part of its documentation.

**Never push, open a PR, or merge without explicit approval.** Committing locally is
pre-authorised; publishing is not.

### 12.3 The pre-commit gate

`.githooks/pre-commit` runs on every commit. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

It runs the shared tests + typecheck always, and the frontend/backend checks when those
packages are touched. **Because `shared/` has no build boundary, a change there re-verifies
both consumers.** Backend integration tests are deliberately excluded — they need a live
database, and a hook that needs a database is a hook people disable; CI covers those.

`git commit --no-verify` exists. Use it only for a throwaway WIP commit on a scratch branch,
never for anything intended to merge.

### 12.4 Prevent scope creep

- **One concern per change.** If you find an adjacent problem while working, *write it down*
  (§14) — do not fix it in the same commit.
- A refactor and a behaviour change never share a commit. If a "cleanup" changes what the
  user sees, it is not a cleanup.
- Mechanical repo-wide renames get their **own** commit with nothing else in it, so review
  and `git bisect` can trust them.
- Don't delete deliberately-provisioned scaffolding (e.g. `rooms.title`, which is
  schema+read-path groundwork for a future feature) just because it has no caller yet. Ask.

### 12.5 Respect feature dependencies

Before you change one of these, check the others:

- **`shared/*`** → verify frontend **and** backend **and** loadtest. No build boundary.
- **A migration** → update `backend/src/db/schema.ts` by hand. Nothing enforces that they
  agree; if they disagree, queries typecheck against a schema the database doesn't have and
  fail at runtime.
- **The wire protocol** (`shared/types/socketProtocol.ts`) → update the server handler, the
  client dispatcher, and `scripts/smoke-test.mjs`.
- **`vite.config.ts` proxy** → mirror it in `frontend/nginx.conf.template`, or it works in
  dev and 404s in prod.
- **An authorisation rule** → change the shared helper, not a call site.

### 12.6 Ask before

- Changing `CANVAS_WIDTH`/`CANVAS_HEIGHT` — `loadCanvas` blanks any stored canvas whose
  dimensions don't match, so this **silently destroys every saved drawing**.
- Altering the DB schema, or editing an already-applied migration (write a new one).
- Anything that changes the wire protocol in a way old clients can't handle.
- Adding a dependency. Prefer the platform (this repo uses built-in `crypto` for scrypt and
  the browser's native `WebSocket` for exactly this reason).

### 12.7 Match the existing style

No semicolons, double quotes, 2-space indent, `//#region` / `//#endregion` folding markers,
folder-per-component with `index.tsx` + `styles.css`. Comments explain **why**, not what —
and if you change behaviour, fix the comment above it in the same commit. Stale comments are
worse than none; readers stop trusting all of them.

---

## 13. Invariants — subtle things that will bite you

### 13.1 Socket listeners attach **before** any await

`RoomManager.addClient` registers `message`/`close`/`error` synchronously, then awaits the
room load, buffering anything that arrives meanwhile. Moving a listener after the await
reintroduces a real bug: clients ping the instant the socket opens, and a room only loads
from the DB when it is *not* cached — i.e. for the first client into any room, every time.
The dropped ping caused a pong timeout → close 4000 → reconnect → and that client leaving
evicted the room, so the retry was cold too. A reconnect loop that silently dropped a user's
first strokes.

### 13.2 `applyDrawInstructionToCanvas` is the single fan-in point

Every network instruction — server broadcast path *and* client receive path — goes through
it, which is why validation lives there. Returning `null` means: no canvas mutation, no
revision bump, no broadcast.

The severe case validation prevents is a **hang, not corruption**: Bresenham is a
`while (true)` stepping one pixel at a time, so `nextPos: [1e9, 1e9]` spins for a billion
iterations. Node is single-threaded, so one message freezes **every room**, and being
synchronous it is uninterruptible. A patch `idx` must also be 4-byte aligned or one colour
smears across two pixels' channels, and a patch is rejected **wholesale** if any entry is
bad — half-applying it would desync the sender's undo stack from the canvas.

### 13.3 Off-canvas strokes: raw positions + clipping (don't "simplify")

`LineAction.prevPos/nextPos` hold **raw, possibly off-canvas** pointer positions;
`handleDraw` clips with `clipSegmentToCanvas` (Liang–Barsky) and sends only the clipped part.

- **Clipping ≠ clamping.** Clamping each axis independently sends (200,60) → (119,60), but
  the segment from (50,50) actually leaves the canvas at (119,55). Clamping *bends* the line.
  There is a test asserting exactly this.
- **Re-entry needs the raw value.** Coming back on-screen, the segment must start where the
  real line crosses the edge — uncomputable from a clamped position.
- **`handleDrawLineLeave` is the wrong place to fix edge behaviour.** `useDrag` calls
  `setPointerCapture`, and while a pointer is captured the browser does **not** fire
  `pointerleave` — so that handler never runs mid-drag. The fix must live on `pointermove`.

`getPosCorrected` still exists and is still right for the **bucket**: a fill clicked outside
the canvas should be ignored, not clipped.

### 13.4 A room always has exactly one owner

Enforced structurally, not by counting: the `room_one_owner` **partial unique index**
(`WHERE role = 'owner'`), plus `ensureMembership` catching the resulting `23505` and falling
back to editor, `setRole` doing ownership changes as an atomic **transfer** in one
transaction, and `removeMember` refusing to remove an owner. The room can never end up
ownerless or two-owned. (`countOwners` exists only so tests can assert this.)

### 13.5 The ref-vs-state splits are deliberate

Selected tool, brush size, colour palette and cursor positions live in **refs** read by
pointer handlers on every event, with parallel **state** only where the UI must re-render.
The alternative is re-rendering React on every pointer move. Know the trade-off before
"fixing" it: `ColorSelector`'s swatch freshness is currently incidental to an unrelated
re-render, which is the cost.

### 13.6 node-postgres JSONB asymmetry

node-postgres does **not** serialise a JS object for a JSONB column on INSERT (hand it
`JSON.stringify`) but **does** parse it on SELECT. That asymmetry is encoded in
`draw_events.instruction`'s three-arm `ColumnType` in `schema.ts`. Get it wrong and it's a
runtime error, not a type error. Also: `db.destroy()` ends the pool — don't also call
`pool.end()`.

### 13.7 `.env` must be LF

CRLF line endings made Compose store the Postgres password **with a trailing `\r`**. The app
worked only because the backend read the same CRLF file; any clean client (host test, CI)
failed auth. `.gitattributes` now forces LF — don't undo it.

---

## 14. Known gaps and backlog

**Architectural**
- **No horizontal scaling.** `rooms` is an in-process `Map`, so presence, cursors, votes and
  broadcasts are all per-process. Multi-instance needs Redis pub/sub. This is the single
  biggest architectural limitation and a good interview topic.
- Rate limiting and sessions are likewise per-process/in-memory.

**Naming — done**
- The long-standing `Pallet`→`Palette` and `Protocall`→`Protocol` misspellings were
  corrected in one atomic pass (plus `Settup`→`Setup`, `Summery`→`Summary`). Files
  `handleFillProtocol.ts`, `handleLineProtocol.ts` and `helperProtocolMethods.ts` are now
  spelled consistently with `handleCanvasProtocol`/`handlePatchProtocol`.
- **One deliberate leftover:** `COLOR_PALETTE_STORAGE_KEY`'s *value* is still
  `"online-whiteboard-color-pallet"`. It is a live sessionStorage key — renaming the string
  would orphan every existing user's saved colours. Identifiers are free to rename;
  persisted data needs a migration. Don't "finish" this one.

**Smaller**
- `rooms.title` is provisioned but never written (deliberate — see §12.4).
- Email verification, password reset, and a breached-password (HIBP) check.
- The loadtest only exercises `ping` + a `pencil` draw — it doesn't touch presence, cursors,
  votes, checkpoints, playback, spray or brush size, and never sends `resync`, so it does
  not exercise the snapshot path.
- Binary frames for snapshots — base64 costs +33% (57600 B → 76800 chars).
- Modal semantics are inconsistent: `PopupBase` centralises dialog role, Escape and `inert`,
  but `Dashboard` hand-rolls Escape and `PlaybackViewer` has neither.
- `.env` lacks `PROD_PORT` (documented in `.env.example`; compose defaults it to 8080).

---

## 15. Key files, ranked by how often you'll need them

1. `backend/src/sockets/roomManager/index.ts` — all server realtime logic
2. `shared/types/socketProtocol.ts` + `shared/types/drawProtocol.ts` — the wire contracts
3. `frontend/src/hooks/useRoomConnection.ts` — client message dispatch
4. `shared/types/identity.ts` — roles + the authorisation rules both sides call
5. `frontend/src/app/App.tsx` — composition root
6. `shared/utils/handleCanvasProtocol.ts` — the apply-instruction fan-in point
7. `backend/src/db/schema.ts` + `backend/src/db/migrations/` — the data model
8. `frontend/vite.config.ts` + `frontend/nginx.conf.template` — aliases + the two proxies
9. `docker-compose*.yaml` + `.env` — how it all runs
10. `frontend/src/hooks/useUndoRedo.ts` + `shared/utils/handlePatchProtocol.ts` — CAS undo
