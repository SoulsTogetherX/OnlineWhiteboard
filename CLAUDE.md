# OnlineWhiteboard — Architecture & Working Notes

> Context document for working on this repo, human or AI. Lives at the repo root so
> Claude Code auto-loads it. Rewritten 2026-07-17 to describe the system as it is now.
> **Corrected 2026-07-20:** §1, §5.1, §5.3, §5.6, §5.7, §7, §8, §11, §14, §16, §17 brought
> back in line with Phases 2–5 — the vote/consensus system (removed in Phase 2) was still
> documented, the canvas was still described as 120×120 (now per-room 256²), the email blind
> index was described as HMAC (it is a slow scrypt KDF), and the test counts and Phase 5
> status were stale.
>
> **Read §12 (Working agreements) before changing anything.**
>
> Picking up mid-project? **§17 is the roadmap** — what is done, what is next, and the
> scope of each remaining phase. **§16 is the decision record** — every non-obvious choice
> with the alternative that was rejected and why. Read both before proposing a change that
> "simplifies" something; most of the traps are already written down there.

---

## 1. What this is

A real-time collaborative **pixel** whiteboard. Users join a **room** by id, draw on a
shared **256×256 RGBA** canvas (per-room, resizable within `[16, 512]` — see Phase 4), and
every stroke propagates live to everyone in that room. Canvas state survives disconnects,
restarts and hard crashes.

The defining architectural decision: **the server owns an authoritative pixel buffer**,
not a list of shapes. Everything else follows from that.

Feature surface today: freehand pencil/eraser, flood-fill bucket, spray can, adjustable
brush size, concurrency-safe undo/redo, live presence + cursors, optional accounts,
per-room roles, owner-only board clearing, named checkpoints with restore, history
playback, a "My Rooms" dashboard with thumbnails, and a saved colour palette.

---

## 2. Tech stack

| Layer      | Choice                                                                     | Notes                                                |
| ---------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| Frontend   | React 19 + Vite 8                                                          | No router, no state library, no CSS framework        |
| Backend    | Express 5 + `ws` 8                                                         | Raw `ws`, **not** Socket.IO                          |
| Database   | PostgreSQL 18-alpine                                                       | Accessed via **Kysely** (typed query builder)        |
| Schema     | Ordered SQL migrations                                                     | `backend/src/db/migrations/00N_*.ts`, run at startup |
| Language   | TypeScript                                                                 | FE `~6.0`, BE `^5.8` — different per package         |
| Runtime    | Node 22 (all images, CI, `@types/node`)                                    | Kept aligned on purpose — see §11                    |
| Dev runner | `tsx watch` (BE), `vite` (FE)                                              | Backend is never compiled in dev                     |
| Prod       | Multi-stage Docker → nginx + esbuild bundle                                | `docker-compose.prod.yaml`                           |
| Tests      | Vitest — shared + backend + frontend (frontend runs node + jsdom projects) | See §11                                              |
| CI         | GitHub Actions                                                             | Verify job + full prod-stack e2e                     |

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
execute the _same source file_. That is why the server can maintain an authoritative canvas
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
  |<-- [BINARY frame: {canvas_snapshot} header + deflated RGBA (256² = 262144B raw)]
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
`Math.random()` on the client is fine; only the _value_ travels.

**Brush size** is a diameter, stamped as a filled disc along the Bresenham path
(`forEachDiscPixel`), deduped per stroke so undo entries stay proportional to area painted
rather than stroke-length × brush-area.

### 5.3 The revision heartbeat — the best perf story here

Every 10s the server broadcasts `{revision_check, revision}` — a few dozen bytes. Each
client compares it to its own last-applied revision; only a client that has **fallen
behind** sends `{resync}`, and only that client receives a fresh snapshot (the whole
canvas — 256²×4 = 262144B raw at the default size, deflated on the wire).

This replaced an older design that broadcast the whole canvas to everyone every 10s:
O(clients × snapshot) → O(clients × ~40B), and the cost no longer grows with canvas size.

### 5.4 Undo/redo — compare-and-swap patches

The most sophisticated part of the codebase.

- While drawing, `withRecording()` wraps the pixel setter so every write also records
  `{idx, from, to}` — the undo entry is built **for free** off the same loop that paints.
- On commit, `coalesceRecording()` collapses that raw recording to **one entry per pixel**:
  the colour it had before the gesture (first `from`), the colour it ended on (last `to`),
  with net-unchanged pixels dropped. **Required, not an optimisation** — see below.
- Undo reverses the entries (`from`↔`to`) and sends a `PatchInstruction`.
- `handleDrawPatchInstruction` applies each entry **only if the pixel currently equals
  `from`**. Anything a collaborator painted over is skipped.
- The applied _subset_ is returned, so the server broadcasts only what really landed and
  the client stacks only what really landed — and tells the user when an undo applied
  partially.

Naive undo in a collaborative app clobbers other people's work. This makes undo safe under
concurrency **without full OT/CRDT machinery**. Second-strongest talking point.

Stack caps are dual: `MAX_ACTIONS = 50` **or** `MAX_BYTES = 48MB`, whichever hits first —
a long scribble is many actions/few entries, a bucket fill is one action/many entries.
Neither cap alone bounds both shapes. `enforceCap` never evicts the **newest** action: you
must always be able to undo the gesture you just made, however large.

#### Why undo used to silently do nothing after a big stroke

Read this before touching any of it. It was **two independent bugs stacked**, either of
which alone was enough to break it:

1. **The recording outgrew what a patch may contain.** `withRecording` appends one entry per
   *write*, and a brush repaints the same pixels on every `pointermove` — so a stroke across
   a 256² canvas recorded several hundred thousand entries for 65,536 pixels. Patch
   validation caps `entries.length` at `width × height`, so the undo patch failed validation
   and `applyDrawInstructionToCanvas` returned `null`. Undo lit up, consumed the action,
   changed nothing, and blamed a collision that had not happened. `coalesceRecording` bounds
   the recording by the only thing that actually bounds it: distinct pixels touched.
2. **The rate limiter dropped the message.** `messageCost` charged a patch
   `1 + entries/500`, pricing a full-canvas undo at 132 units (256²) or 525 (512²) against a
   600-unit burst budget **that the stroke being undone had just spent**. The client applied
   the undo locally, the server never saw it, and the revision heartbeat dragged the canvas
   back. A patch is one compare-and-set per entry — *cheaper* per pixel than the flood fill
   charged 10 — so the divisor is now `10_000` and the worst legal patch costs 27.

The invariant that keeps (2) fixed, pinned by a test in `socketLimits.test.ts`: **no message
a client is allowed to send may cost a large slice of the burst budget**, because the budget
is never full when it arrives — the gesture that produced the big message is what drained it.

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

A cursor also carries the **tool** it is holding (`CursorTool`), so both the local pointer
and everyone else's render that tool's glyph rather than a generic arrow. Three things about
it are deliberate:

- `CursorTool` lives in the **socket protocol**, not the frontend, because two sides now
  have to agree on the spelling. It includes `eyedropper`, which is not a `ToolType` (it
  produces no draw instruction) but is something people can watch you use.
- It is **validated against the known set**. The value is relayed verbatim to every other
  client, so an unchecked one would be attacker-chosen text arriving at everyone's renderer.
- The tool is React **state**, unlike the position: it changes only when someone picks a new
  tool, and the update bails out when unchanged, so the ~22 moves/second stay render-free.

Tool glyphs live as **path data** in the tool descriptors (`DrawingTab/tools.tsx`), not JSX,
because the same shape becomes both a React icon and an SVG data-URI CSS cursor. Each
descriptor also carries a **hotspot**, so a click lands on the pencil's tip or the bucket's
spout, and both renderings agree on where "here" is.

### 5.6 Roles and authorisation

`ConnectionRole = "owner" | "editor" | "viewer" | "guest"`.

The rules live once, in `shared/types/identity.ts`, and **both sides call them**:

| Helper             | Allows                                                           | Who                                                                       |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `canDraw`          | drawing                                                          | `owner`/`editor` always; `viewer`/`guest` only while `open_editing` is on |
| `hasEditAuthority` | create/restore/delete checkpoints                                | `owner`, `editor`                                                         |
| `canManageRoom`    | clear, resize, toggle open editing, change roles, remove members | `owner` only                                                              |
| `canRequestEditor` | ask the owner for editor access                                  | `viewer` only                                                             |

The server is the authority; client checks are cosmetic (greying out controls). A crafted
client cannot bypass them — `RoomManager` re-checks on every message.

Membership: everyone — including the first visitor — joins as a **viewer**. Ownership is
never automatic: it is **claimed** on an unowned room and **released** explicitly, and it
persists across sessions. Guests are never members. A room has **at most one owner**,
enforced structurally (§13.4).

### 5.7 Destructive actions are owner-only

Clearing the board is not a draw instruction a client may send — the server **rejects** a
client-originated `clear`. The only path is a `room_action` message, which the server
applies on the owner's behalf **after checking `canManageRoom` (owner only)**. It then flows
through the normal event-log + broadcast path like any other instruction.

An earlier design gated clears behind a consensus **vote** among recent editors (unanimous
approval, timeouts, a voter set). Phase 2 removed it entirely (§16, §17): one accountable
owner is simpler to reason about and deletes a whole class of stuck-vote edge cases rather
than handling them. There is no `request_action` message, no voter set, and no vote timers
in the protocol any more.

### 5.8 Checkpoints and playback (time travel)

- **Checkpoint** = a named, durable full-canvas snapshot at a revision. Editors only.
  Capped at **20 per room**; pixels are captured synchronously before any await so the
  stored bytes and revision can't disagree.
- **Restore** sets the live pixels, bumps the revision, persists, and broadcasts a fresh
  snapshot to everyone. It is _not_ logged as an instruction — the new snapshot **is** the
  state, and recovery reads the latest snapshot.
- **Playback** is read-only, so anyone (including viewers) may watch. With no checkpoint the
  server sends the **genesis base** (earliest snapshot) + the ordered events after it, so the
  scrub covers the room **start-to-end** (Phase 6); from a checkpoint it sends that checkpoint
  - events after it. The client animates by applying them, and the scrubber shows checkpoint
    tick-marks + prev/next jump.

Retention (Phase 6, §6): each room keeps **two snapshots** — a genesis base and the head —
and retains every event after the base so the timeline replays start-to-end, bounded by
**uniform decimation** at `MAX_HISTORY_EVENTS`. Decimation only ever deletes events already
baked into the head snapshot, so it never affects recovery.

---

## 6. Persistence and durability

Data model: `rooms` + `canvas_snapshots` + `draw_events` (+ `users`, `sessions`,
`saved_colors`, `room_members`, `checkpoints`).

**Event sourcing is what makes data loss sub-second.** Every applied instruction is appended
to `draw_events`, flushed in batches every `FLUSH_INTERVAL_MS = 250ms` (or early past
`MAX_EVENT_BUFFER = 200`). Recovery = latest snapshot + replay every event with a greater
revision, through the **same** `applyDrawInstructionToCanvas` the live path and unit tests
use.

| Mechanism                  | Interval | Purpose                                                  |
| -------------------------- | -------- | -------------------------------------------------------- |
| Event flush                | 250 ms   | Durability floor — bounds hard-crash loss                |
| Snapshot / save            | 15 s     | Recovery base; also compacts the log                     |
| `revision_check`           | 10 s     | Cheap sync heartbeat (§5.3)                              |
| ws ping                    | 30 s     | Dead-socket reaping                                      |
| Stale-room + session sweep | 24 h     | Bounds the only unbounded tables (90-day room retention) |

**Retention (Phase 6)**: writing a snapshot keeps **two** snapshots — the genesis base and
the head — and, in the **same transaction**, prunes only the events at or below the base (all
baked into the base snapshot). Everything after the base is retained so the timeline replays
start-to-end; that span is bounded by **uniform decimation** (`historyDecimation.ts`,
`MAX_HISTORY_EVENTS`) run from `saveRoom` right after the snapshot. A **resize** collapses to
a single snapshot and prunes every event it supersedes (`resetBase`) — the hard boundary.
Decimation and pruning only ever touch events already in a snapshot, so recovery (head +
events after it) is unaffected.

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
- **Logout also force-closes every live socket for that session** server-side — a session
  registry keyed by the token _hash_ closes them with code `1008`. A socket is authenticated
  once at upgrade and then lives for the tab's lifetime, so deleting the session row alone
  would leave it acting as the logged-in user; the registry is what makes logout end access
  immediately on a shared machine. A periodic sweep (30 min) likewise drops sockets whose
  session has expired or been revoked.

---

## 8. Security posture

| Threat                                  | Defence                                                                                                                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSWSH (cross-site WebSocket hijacking)  | Origin allowlist checked at the upgrade, before it becomes a socket. `SameSite` does **not** reliably cover WS upgrades — this is the primary defence.                                                                              |
| CSRF                                    | `csrfOriginGuard` on state-changing API requests, on top of `SameSite=Lax`.                                                                                                                                                         |
| Credential stuffing                     | Per-IP rate limits: login **10 / 15 min**, register **5 / 60 min** (keyed off nginx's `X-Real-IP`). In-memory, so per-process — multi-instance needs Redis.                                                                         |
| Weak / breached passwords               | Common-password blocklist (`auth/validation.ts`) **plus** live **HIBP k-anonymity** breach screening (`auth/breachedPassword.ts`, fail-open). The blocklist is the floor; HIBP is what actually stops reused-from-a-leak passwords. |
| Socket flooding / DoS                   | **Weighted-cost token bucket** (cost = server _work_, not message count) + **per-identity connection caps** enforced at the WS upgrade _before_ any DB query — `backend/src/security/socketLimits.ts`. In-memory / per-process.     |
| Deanonymisation                         | `Participant` carries no account id (§5.5).                                                                                                                                                                                         |
| Malicious instructions                  | Two-layer runtime validation: `shared/utils/validateSocketMessage.ts` guards the **envelope** (message type + all non-pixel fields), `validateInstruction.ts` guards the **pixel payload** at the single fan-in point (§13.2).      |
| Clickjacking / sniffing / TLS downgrade | `security-headers.conf`: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy.                                                                                                                                            |

**Origin allowlist fails OPEN in development, CLOSED in production.** If `ALLOWED_ORIGINS`
(or `PUBLIC_SITE_URL`) is unset, dev still runs — a check that blocks local work gets
deleted — but production **refuses** browser requests and logs at error level. A security
control that silently switches itself off when misconfigured is worse than one that breaks
loudly. Requests with **no** Origin (health probes, the smoke test, curl) are always allowed;
they can't carry a victim's cookie.

> `nginx add_header` inheritance trap: a `location` with its own `add_header` drops **all**
> inherited ones. That's why `security-headers.conf` is `include`d in the server block _and_
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
curl http://127.0.0.1:8080/api/health                                    # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/any/route   # 200 (SPA fallback)
node scripts/smoke-test.mjs http://127.0.0.1:8080                        # full protocol probe
node scripts/security-probe.mjs http://127.0.0.1:8080                    # adversarial probe
```

> **Use `127.0.0.1`, not `localhost`, when probing from a Windows host.** Docker publishes
> the port on both `0.0.0.0` and `[::]`, but `localhost` can resolve to IPv6 `::1` where the
> binding intermittently refuses connections — while `127.0.0.1` works. The symptom is
> maximally misleading: every container reports **healthy**, nginx serves fine _inside_ the
> container, and yet the smoke test dies with a bare `fetch failed`, which reads exactly like
> the app is broken. It isn't. CI runs on Linux and is unaffected.

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
- **`/@fs/` escape hatch**: `shared/` is _outside_ the Vite root, and Vite serves it via
  `/@fs/`. This is load-bearing — tightening `server.fs.allow` or changing the root breaks
  the app instantly.
- **The dev proxy is the most load-bearing 8 lines**: `/api` and `/ws` (with `ws: true`)
  proxy to the backend, so the browser only ever talks to its own origin — no CORS, no
  hardcoded backend URL. `frontend/nginx.conf.template` re-implements exactly this for prod;
  **the two must be kept in agreement.**
- **The invariant that makes one artifact run anywhere**: the client requests a _relative_
  `/ws`, and `toWebSocketUrl` resolves it against `window.location`, upgrading
  `http:`→`ws:` / `https:`→`wss:`. Do **not** "fix" this into a `VITE_WS_URL` env var —
  that reintroduces a per-environment rebuild for no benefit.
- `vite build` does **not** typecheck. `tsc -b` is what enforces types.

---

## 11. Tests and CI

Three suites, each matched to what it is good at:

| Suite                  | Command                   | Count                                                       | Needs                          |
| ---------------------- | ------------------------- | ----------------------------------------------------------- | ------------------------------ |
| Shared protocol (unit) | `npm test` (root)         | **162** in 15 files                                         | nothing                        |
| Frontend               | `cd frontend && npm test` | **95** in 21 files (two projects)                           | nothing                        |
| Backend                | `cd backend && npm test`  | **135** in 16 files (DB tests gated on `POSTGRES_PASSWORD`) | Postgres for the DB-gated ones |

The shared suite is the highest-value code in the repo to test: pure, deterministic, no DOM
/ network / database, and **both sides execute it** — a bug there desynchronises every
client from the server's canvas.

The **frontend** suite splits into two Vitest projects by file extension
(`frontend/vitest.config.ts`): a `node` project for pure DOM-free logic (`*.test.ts`:
colour maths, `localHold`, `reanchor`) and a `jsdom` project for React component tests
(`*.test.tsx`, via Testing Library + `vitest.setup.ts` — added in Phase 5). Name the file
for the environment you need.

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

**Throwaway two-socket probes are the fastest way to verify anything protocol-level**, and
often better evidence than a browser. Open two `WebSocket`s to the same room against the dev
backend (`ws://localhost:3000/ws?roomId=…`, published by the dev compose file for exactly
this), have one send and assert what the other receives. The cursor-tool work was verified
this way in a few seconds — tool relayed, tool change propagated, an unknown tool rejected
and never relayed, a tool-less cursor still working — after the in-app preview browser
proved unreliable for it. Keep them in the scratchpad unless they earn a place in `scripts/`.

> **Typecheck with `--noEmit`, never `tsc -b`.** Every package's `typecheck` script is
> `tsc --noEmit` for a reason: `tsc -b` **emits** `.js` next to the `.ts` sources, and Vitest
> then resolves the stale JavaScript in preference to the TypeScript. The symptom is
> `Cannot find module '@shared/...'` from a `.js` file you never wrote, in tests that
> passed a minute ago — it reads like the alias config broke, and _every_ suite fails at
> once, which by §12.1's own rule means "suspect the harness". Clean up with
> `find <pkg>/src -name '*.js' -delete`, but scope it: `backend/src/types/ClientSocket.d.ts`
> is a real tracked source file, and a broad `-name '*.d.ts' -delete` will eat it.

Local integration tests: a native Windows Postgres on `:5432` **shadows** the Docker one for
host connections — use a throwaway on a free port
(`docker run -p 55432:5432 postgres:18-alpine`) and point `POSTGRES_PORT` at it.

---

## 12. Working agreements — READ BEFORE CHANGING ANYTHING

These are enforced where they can be (see the gate below) and expected where they can't.

### 12.1 Verify every change — typecheck is not verification

`tsc` and `eslint` prove the code _compiles_, not that it _works_. Every feature needs
evidence it does what it claims, at the cheapest level that actually demonstrates it:

| Change                                    | Minimum acceptable verification                                       |
| ----------------------------------------- | --------------------------------------------------------------------- |
| Pure logic (`shared/`, utils, validation) | A unit test that fails before the change                              |
| Repository / SQL                          | Integration test against a real Postgres                              |
| Protocol change                           | Both sides updated + `scripts/smoke-test.mjs`, or a live socket probe |
| UI behaviour / a11y                       | **Drive it.** Run the app and observe the actual behaviour            |
| Security control                          | A test asserting both the allow AND the deny path                     |

State in the commit message _how_ it was verified, with observed values where possible.
"Typechecks" is not an answer for anything with runtime behaviour.

#### Trust the failure signal before you trust the failure

Two separate incidents in this repo produced the _same_ misleading symptom — a test
reporting `fetch failed` while the application was fine — and both cost a wrong diagnosis:

1. **A masked exit code.** `docker compose up --wait -d | tail -2 && node smoke-test.mjs`
   does not do what it looks like. A pipeline's exit status is the status of its **last**
   command, so `&&` saw `tail` succeed. Compose had failed, the stack was never up, and the
   smoke test ran against nothing — reporting what looked exactly like a broken app.
2. **A host resolution quirk.** `localhost` resolving to IPv6 `::1`, where the published
   port refused, while `127.0.0.1` worked (see §9).

The rules that follow from this:

- **Never pipe a command whose exit code you are about to branch on.** Either drop the
  pipe, or `set -o pipefail` first, or capture the status explicitly:
  ```bash
  set -o pipefail                       # simplest fix; failure propagates through pipes
  docker compose ... up --wait -d; rc=$? # or capture it before trimming output
  ```
- **When a probe fails, confirm the harness before blaming the code.** Is the stack up
  (`docker compose ps`)? Is the port answering (`curl`)? A green container list and a
  failing probe is a _contradiction_, and the contradiction is the clue.
- **Suspicion is proportional to symptom breadth.** One assertion failing is usually the
  code. _Everything_ failing at once — especially the very first network call — is usually
  the harness.

### 12.2 Commit after each verified feature

One concern per commit, on the **`dev`** branch, **after** it is verified. `dev` is the
integration branch — all work lands here directly (not on scattered feature branches), and
`dev` is **squash-merged to `main` via a PR as a versioned release** (`V1.x.0`). So `main`
carries one clean commit per release while `dev` keeps the granular, per-concern history
this repo treats as documentation. Commit messages explain _why_, not just what.

> **Squash-divergence gotcha when opening the dev→main PR.** Because each release
> squash-merges `dev` into `main`, `main` becomes an older _subset snapshot_ of `dev`'s
> work whose commits are **not ancestors** of `dev` — a naive merge then conflicts and
> duplicates code. Before opening the PR, record `main` as an ancestor without changing
> `dev`'s tree: `git merge -s ours origin/main` on `dev` (verify the tree sha is unchanged),
> then push. Confirm clean with `git rev-list origin/main ^origin/dev` (empty = main is an
> ancestor). This is why `dev`'s history carries periodic "Merge main into dev" commits.

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

- **One concern per change.** If you find an adjacent problem while working, _write it down_
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

### 12.8 Naming — one concept, one name, everywhere

The repo has already paid for getting this wrong: `Pallet` (a shipping platform) meant
`Palette` for months, and `Protocall` vs `Protocol` split the draw handlers into two
spellings that both had to be imported side by side. Renaming later cost an atomic
cross-package sweep, because `shared/` has no build boundary.

- **Spell it correctly, in full, in English.** No invented words, no phonetic guesses. If
  you are unsure of a spelling, look it up before it reaches three packages.
- **Identifiers use `color`, prose may use "colour".** `color` matches the DOM, CSS and the
  existing `ColorType`/`colorsEqual` API. Do not introduce `colour` as an identifier.
- **One concept = one name across frontend, backend and shared.** Never rename a thing as it
  crosses a package boundary; the wire protocol and the type that models it share names.
- **Booleans read as predicates:** `isOpen`, `hasEditAuthority`, `canDraw`, `shouldRetry`.
- **Handlers:** `onThing` for the prop a component accepts, `handleThing` for the
  implementation that satisfies it. Don't use `onThing` for a local function.
- **Hooks are `useThing`** and return a named object once there is more than one value —
  positional tuples stop being readable at three.
- **Don't abbreviate new identifiers.** `instruction`, not `inst`; `revision`, not `rev`.
  (Existing `inst`/`da` params predate this rule; match locally, don't spread it.)
- **Module-scope constants are `SCREAMING_SNAKE`** and carry a comment saying _why that
  value_ — `MAX_STROKE_SIZE = 32` is a security bound, not a taste preference.

### 12.9 Rules that exist because something broke

Each of these encodes a real defect. They are cheap to follow and expensive to relearn.

- **Never trust network data through an `as` cast.** `as` is a compile-time assertion, not a
  runtime check. Validate at the fan-in point (§13.2). A crafted `nextPos` once froze the
  event loop for every room because Bresenham is a synchronous `while (true)`.
- **Never loop over a network-supplied number without a bound.** Every such value needs a
  cap in `validateInstruction`, and the cap needs a comment explaining the abuse it stops.
- **An authorisation rule lives in exactly one shared helper.** Use `canDraw` /
  `hasEditAuthority` / `canManageRoom` — never re-inline `role === "owner"` at a call site.
  The client and server must grey out and enforce with the _same_ predicate, or the UI will
  eventually lie about what the server will accept.
- **Duplicate logic moves to `shared/` the second time it appears, not the third.** Colour
  equality reached three implementations (fill, undo CAS, frontend) before anyone noticed.
  If the fill and the undo CAS had ever disagreed on "same colour", clients would have
  silently drifted from the server's canvas.
- **A magic number used on both sides is a shared constant.** Checkpoint-name length and the
  role list were each hardcoded twice and could drift independently.
- **Check `utils/` before writing a helper.** Relative-time formatting, byte clamping and
  localStorage array access each got reimplemented because the original wasn't exported.
  If you need a private helper elsewhere, export it — don't retype it.
- **Don't `export` until there are two callers.** Unused exports read as public API, so
  nobody dares delete them. Several accumulated exactly this way.
- **Prefer exhaustive `switch` over a discriminated union with no `default`.** That way
  adding a variant to the union is a _compile_ error at every site that must handle it.
  `applyDrawInstructionToCanvas` relies on this; keep it.
- **One modal pattern.** Route dialogs through `PopupBase` so `role="dialog"`, `aria-modal`,
  Escape-to-close and `inert` are handled once. Two components bypassed it and each lost a
  different piece of that.
- **Interactive means keyboard-operable.** Anything with `role="slider"`/`"button"` or a
  `tabIndex` needs key handling and ARIA state. A focusable control that ignores the
  keyboard is _worse_ than a plain `<div>`: it advertises support it doesn't have.
- **`var(--name, fallback)` on a var that doesn't exist fails silently.** It is
  indistinguishable from one that does, so a whole surface can ignore the theme while
  looking deliberate. Three stylesheets did. When something "doesn't follow the theme",
  grep for `var(--` with a comma first.
- **Check dark mode with numbers, not eyes.** Colours picked against a light background can
  invert into text-on-its-own-colour: a role chip measured **1.15:1** against its own label.
  Dark surfaces also need a _wider_ absolute gap than light ones to read as equally soft —
  the grid needed 1.31:1 where the light theme was fine at 1.19.
- **Price a cost model against the budget it spends from.** The rate limiter charged a
  full-canvas undo up to 525 of a 600-unit burst — defensible in isolation, except the
  budget is never full when that message arrives, because the gesture that produced it is
  what drained it. Cost the worst _legitimate_ message, then prove it survives a drained
  bucket.
- **Unit-verified is not end-to-end verified.** The no-op-instruction change was correct and
  fully unit-tested, and still broke `permissions-probe.mjs` — whose strokes were all
  identical and so became no-ops. Run the probes against the prod build before calling a
  protocol-level change done.

### 12.10 Definition of done

A change is finished when **all** of these are true — not when it compiles:

1. It does what was asked, and nothing that wasn't (§12.4).
2. It was **driven**, not just typechecked (§12.1). Name the observation in the commit.
3. Tests cover the new behaviour, and you watched a relevant one **fail** before it passed.
4. Comments touching the changed behaviour are updated in the same commit.
5. Every consumer named in §12.5 was checked.
6. The pre-commit gate passes without `--no-verify`.
7. Anything you noticed but deliberately did not fix is written down in §14.

---

## 13. Invariants — subtle things that will bite you

### 13.1 Socket listeners attach **before** any await

`RoomManager.addClient` registers `message`/`close`/`error` synchronously, then awaits the
room load, buffering anything that arrives meanwhile. Moving a listener after the await
reintroduces a real bug: clients ping the instant the socket opens, and a room only loads
from the DB when it is _not_ cached — i.e. for the first client into any room, every time.
The dropped ping caused a pong timeout → close 4000 → reconnect → and that client leaving
evicted the room, so the retry was cold too. A reconnect loop that silently dropped a user's
first strokes.

### 13.2 `applyDrawInstructionToCanvas` is the single fan-in point

Every network instruction — server broadcast path _and_ client receive path — goes through
it, which is why validation lives there. Returning `null` means: no canvas mutation, no
revision bump, no broadcast.

`null` also means **"this changed nothing"**. Patches always reported that (a patch whose
every entry loses its compare-and-swap returns `null`); line, spray and fill could not,
because they returned `void` — so drawing a colour over itself still bumped the revision,
wrote an event and broadcast it, and the timeline filled with steps that render no visible
change. They now return a **changed-pixel count** (via `withChangeCount`, the counting
sibling of `withRecording`) and the fan-in maps zero to `null`. The pixels are still
*written* either way, so a replaying caller — which ignores the return value — is unaffected
and clients stay byte-identical to the server.

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
  the segment from (50,50) actually leaves the canvas at (119,55). Clamping _bends_ the line.
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
- **One deliberate leftover:** `COLOR_PALETTE_STORAGE_KEY`'s _value_ is still
  `"online-whiteboard-color-pallet"`. It is a live sessionStorage key — renaming the string
  would orphan every existing user's saved colours. Identifiers are free to rename;
  persisted data needs a migration. Don't "finish" this one.

**Smaller**

- **A full page reload into a DIFFERENT room may leave the client not joined to it.**
  Found while browser-testing Phase 4. `roomId` comes from `useSessionStorage`; the suspicion
  is that on mount the hook briefly yields the default (`testRoom`) before hydrating the stored
  value, so the socket connects to `testRoom`, then `roomId` changes and it reconnects — and
  the reconnect does not reliably land the client in the intended room (a fresh peer joining
  the same room id saw presence 1, and the client rendered none of that peer's draws). A
  fresh TAB load (no reload) is unaffected, and the in-app room switch may be too — reproduced
  only via reload with a pre-seeded different `sessionStorage` room. Not chased down because it
  is unrelated to the resize/undo work it surfaced under; Phase 5 reworks the room UI and is
  the natural place to fix it. Verify with two clients + a presence assertion after a reload.
  - **Probably resolved by the Phase 6.5 lobby split, but NOT confirmed.** The suspected
    cause was `useRoomConnection` reading the room from `useSessionStorage` and briefly
    yielding the default before hydrating. It no longer reads storage at all: the board
    mounts only once the shell knows the room, and takes it as `initialRoomId`, so there is
    no window where the socket connects to a room nobody asked for. Still needs the
    two-client presence check above before this is struck out.
- `rooms.title` is provisioned but never written (deliberate — see §12.4).
- Email verification and password reset. (The breached-password **HIBP** check is **done** —
  it shipped in Phase 1; see §7/§8/§17. Only verification and reset remain.)
- The loadtest only exercises `ping` + a `pencil` draw — it doesn't touch presence, cursors,
  votes, checkpoints, playback, spray or brush size, and never sends `resync`, so it does
  not exercise the snapshot path.
- **Modal semantics — done (Phase 5).** Every dialog now routes through `PopupBase`, so the
  dialog role, `aria-modal`, Escape-to-close and `inert`-when-closed are handled once. The
  `Dashboard`'s hand-rolled Escape and the `PlaybackViewer`'s missing Escape/`inert` are gone.
- **Stale CSS var names — done (Phase 6.5).** `Dashboard`, `PlaybackViewer` and
  `MembersPopup` referenced `var(--border,#ccc)` / `var(--card-bg,…)` / `var(--tag-bg,#eee)`
  — names that never existed, so every fallback fired and those surfaces ignored the theme
  entirely. Harmless-looking on a light background; in dark mode the Members role chips
  measured **1.15:1** against their own label. All three now read real variables.
  - Worth generalising: `var(--name, fallback)` **fails silently and looks deliberate**. A
    fallback on a var that does not exist is indistinguishable from one that does, so grep
    for `var(--` with a comma when a surface "doesn't follow the theme".
- **Playback's final frame is approximate for decimated or restored rooms.** Start-to-end
  replay = genesis base + retained events. Once a room's history has been uniformly decimated
  (Phase 6), or a checkpoint _restore_ has jumped the canvas without logging an instruction,
  replaying those events no longer reconstructs the exact current canvas — so the scrubber's
  last frame (and intermediate frames) drift from reality. Deliberate (§16 accepts thinned
  fidelity), and the live board is always exact. A follow-up could send the true head canvas
  on the `playback` message to make the end frame exact (§16 records why it wasn't).
- `.env` lacks `PROD_PORT` (documented in `.env.example`; compose defaults it to 8080).

---

## 15. Key files, ranked by how often you'll need them

1. `backend/src/sockets/roomManager/index.ts` — all server realtime logic
2. `shared/types/socketProtocol.ts` + `shared/types/drawProtocol.ts` — the wire contracts
3. `frontend/src/hooks/useRoomConnection.ts` — client message dispatch
4. `shared/types/identity.ts` — roles + the authorisation rules both sides call
5. `frontend/src/app/Whiteboard.tsx` — the in-room composition root (`App.tsx` is now just
   the shell that picks between the lobby and the board)
6. `shared/utils/handleCanvasProtocol.ts` — the apply-instruction fan-in point
7. `backend/src/db/schema.ts` + `backend/src/db/migrations/` — the data model
8. `frontend/vite.config.ts` + `frontend/nginx.conf.template` — aliases + the two proxies
9. `docker-compose*.yaml` + `.env` — how it all runs
10. `frontend/src/hooks/useUndoRedo.ts` + `shared/utils/handlePatchProtocol.ts` — CAS undo

---

## 16. Decision record

Decisions taken deliberately, with the alternative that was **rejected and why**. The rejected
option usually looks like an obvious improvement to someone reading the code cold — that is
exactly why it is written down. Do not "fix" one of these without revisiting the reasoning.

| Decision                                                                                                                                                                                                    | Rejected alternative                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Email: blind index + encrypted at rest.** Store a **slow-KDF (scrypt) blind index** of the email for lookup, and the address encrypted (AES-256-GCM, AAD = user id) with a key held outside the database. | Plaintext email column.                                                                           | A database-only leak then reveals no addresses. Plaintext is the single most commonly breached PII field.                                                                                                                                                                                                                                                                                                                                                                    |
|                                                                                                                                                                                                             | **HMAC-SHA256** blind index (the usual choice for a blind index).                                 | Email is low-entropy and enumerable, so a _fast_ keyed hash lets anyone holding the DB + pepper brute-force the whole address space offline. A deliberately slow KDF makes each guess cost real time. (The code explicitly rejects HMAC here.)                                                                                                                                                                                                                               |
|                                                                                                                                                                                                             | Hash-only, unrecoverable.                                                                         | Loses the address forever: no password reset, no verification, no way to contact a user.                                                                                                                                                                                                                                                                                                                                                                                     |
| **Passwords: scrypt**, salted and memory-hard.                                                                                                                                                              | Anything faster (SHA-256, bcrypt-with-low-cost).                                                  | A fast hash is exactly what makes a leaked table brute-forceable. Memory-hardness is the point.                                                                                                                                                                                                                                                                                                                                                                              |
| **100 ms responsiveness is PERCEPTUAL.** Your own action renders instantly and is held ≥100 ms against a colliding remote instruction; final pixels still converge byte-identically.                        | "First writer actually wins."                                                                     | Real conflict resolution would change the authoritative-server model and risk divergence. The goal is that input never _feels_ eaten — not that collaborators can't paint over each other.                                                                                                                                                                                                                                                                                   |
| **Ownership: persistent, opt-in.** You claim an unowned room and keep it across sessions.                                                                                                                   | Session-only ownership released on disconnect.                                                    | Every room setting (guest-editing toggle, assigned roles) would reset whenever the last owner left.                                                                                                                                                                                                                                                                                                                                                                          |
| **Resize: crop/pad from top-left.**                                                                                                                                                                         | Scale/resample.                                                                                   | Resampling rewrites every pixel, so the undo stack and event log no longer describe the canvas. Crop/pad is lossless for the kept region.                                                                                                                                                                                                                                                                                                                                    |
| **Snapshots: binary frames + deflate; `draw_events` stays raw JSON.**                                                                                                                                       | Compressing the event log too.                                                                    | Instructions are tiny and on the latency-critical path; compressing them trades the thing we care about (speed) for the thing we don't (a few bytes).                                                                                                                                                                                                                                                                                                                        |
| **Compression is APPLICATION-level: deflate the snapshot payload ourselves.** `perMessageDeflate: false` is set explicitly in `server.ts`.                                                                  | Transport-level `permessage-deflate` on the `ws` server (which is what was originally asked for). | OWASP advises against transport compression: when attacker-influenced data shares a compression context with secrets, the compressed **size** leaks content — the CRIME/BREACH class. Compressing only the snapshot payload means the compressed buffer holds pixel bytes and nothing else, so no oracle exists. Same bandwidth win, and far more predictable memory, which `permessage-deflate` is notoriously not. **Do not "simplify" this by turning the flag back on.** |
| **History: uniform decimation.**                                                                                                                                                                            | Keep the ends sharp, thin only the middle.                                                        | Chosen so the _whole_ timeline stays scrubbable at even fidelity. Accepted cost: recent history is thinned too.                                                                                                                                                                                                                                                                                                                                                              |
| **Two-snapshot retention (genesis base + head).** Retain the whole event log after the base; bound it with decimation (Phase 6).                                                                            | Keep only the latest snapshot and prune everything below it (the pre-Phase-6 behaviour).          | Recovery needs only the head, but start-to-end playback needs a genesis base to replay forward from. The base is ≤ every event, so decimation only ever touches events already baked into the head snapshot — recovery is provably unaffected, which is what lets storage be bounded without risking durability.                                                                                                                                                             |
| **Playback final frame shown as the replay renders it** (approximate after decimation or a checkpoint restore).                                                                                             | Ship the true head canvas on the `playback` message and show it at the scrubber's max.            | The timeline is a visualisation decoupled from durability; §16 already accepts thinned intermediate frames, so an approximate last frame for heavily-decimated / restored rooms is acceptable — and it avoids a wire-protocol change entirely.                                                                                                                                                                                                                               |
| **Timeline navigation (markers + prev/next) is open to everyone; restore stays privileged.**                                                                                                                | Owner-only timeline navigation (a literal reading of the Phase-6 note).                           | Playback is read-only, and checkpoint metadata is already broadcast to all; the _write_ (restoring the board to a checkpoint) is what stays gated (`hasEditAuthority`, unchanged).                                                                                                                                                                                                                                                                                           |
| **UI tests: Testing Library + jsdom, plus the two-client Node harness.**                                                                                                                                    | Playwright E2E.                                                                                   | Avoids a browser-automation toolchain and CI browser downloads. Accepted cost: hover tooltips are asserted via ARIA attributes, not real hover.                                                                                                                                                                                                                                                                                                                              |
| **Undo is `Ctrl+Z` / `Ctrl+Shift+Z`.**                                                                                                                                                                      | `Ctrl+V`.                                                                                         | `Ctrl+V` is paste; shadowing a universal shortcut confuses every user.                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Display names cap at 24 chars**, ellipsised, full value in `title` + `aria-label`.                                                                                                                        | Hard truncation.                                                                                  | Truncating without the full value in an accessible attribute hides information from screen readers.                                                                                                                                                                                                                                                                                                                                                                          |
| **No vote system.** Destructive actions are owner-only.                                                                                                                                                     | Consensus voting among recent editors (previously implemented, now removed).                      | A single accountable owner is simpler to reason about and to explain, and removes a whole class of stuck-vote edge cases.                                                                                                                                                                                                                                                                                                                                                    |
| **Lobby first: the app opens with no room joined.** | Drop straight into a remembered room, or deep-link rooms by URL. | Makes "which room am I in" explicit state rather than a side effect of storage — which is what the pre-existing reload-into-the-wrong-room bug was. The board and its socket only exist once a room is chosen. Accepted cost: a refresh returns to the lobby; no shareable room URLs yet. |
| **Account lives in its own sidebar tab; the timeline moved into the Room tab.** | Keep the timeline as a tab and put account controls in a corner or a popup. | Organised by what the user is thinking about, not by feature: a room's history is a fact ABOUT that room, while identity outlives every room. It also collects account controls that had drifted into two different places. |
| **Rename/delete are scoped by the session cookie alone** — `PATCH`/`DELETE /api/auth/me` take no user id. | Take a user id in the path or body and authorise it server-side. | An id parameter on "rename me" is an invitation to try it on someone else, and makes every future caller a place the check could be forgotten. No id means no such bug is expressible. |
| **Account deletion relies on the schema's `ON DELETE` rules.** | Delete dependent rows explicitly in application code. | The database already states the relationships; re-implementing them in a handler means two descriptions that can drift. Memberships (ownership included) cascade, so rooms become unowned; rooms the user CREATED survive with `created_by` nulled, because a room is shared work. |
| **The cursor's tool travels on the wire; `CursorTool` lives in the socket protocol.** | Infer a peer's tool from the draw instructions they send. | Inference is wrong exactly when it matters — before someone draws — and would show nothing for a hovering pointer. Validated against a known set because the value is relayed verbatim into every other client's renderer. |
| **Focus decides who owns the wheel: canvas zoom by default, the slider while one is focused.** | Always require shift+wheel to zoom (the previous rule). | Reserving the plain wheel cost the gesture people actually reach for. Focus is the one signal that survives the pointer being over the canvas, which is exactly where you are when sizing a brush and watching the result. |

---

## 17. Roadmap — where the project is

Seven phases, ordered by dependency and by the stated priority: **security → speed →
memory**. Each lands as its own verified commit (§12.2). Phases 1–2 are done.

### ✅ Phase 1 — Security

Socket envelope validation (replacing an `as` cast that checked nothing at runtime); a
patch entry-count bound and an explicit `maxPayload` (`ws` defaults to 100 MiB);
weighted-cost flood control and per-identity connection caps; email encrypted at rest
behind a slow-KDF blind index; breached-password screening via HIBP k-anonymity; and a
session lifecycle that actually disconnects sockets on logout.

### ✅ Phase 2 — Ownership, roles and permissions

Voting removed entirely. Everyone joins as a **viewer**; ownership is claimed, released,
and transferable, never automatic. `open_editing` decides whether anyone below editor may
draw. Editor requests round-trip to the owner.

### ✅ Phase 3 — Protocol, compression, and the 100 ms guarantee

- Snapshots moved from a base64 JSON field to **binary WebSocket frames** — a versioned
  envelope (`shared/utils/binaryFrame.ts`): a small JSON header plus the raw payload.
- The snapshot payload is **application-level deflated** (`deflate-raw`), never
  `permessage-deflate` (§16, and it stays off). Blank canvas: ~57 KB → ~70 B on the wire.
- Snapshot/checkpoint `BYTEA` columns are **gzipped** (`pixelStorage.ts`); the CRC catches
  silent corruption that the wire's raw-deflate does not need to. `draw_events` stays JSON.
- Patches travel as **packed binary frames** (12 B/entry, `shared/utils/patchCodec.ts`), so
  `maxPayload` came down honestly from 4 MiB to **256 KiB**.
- **The 100 ms guarantee** is a display-only overlay (`frontend/src/utils/localHold.ts`):
  remote instructions apply to the authoritative buffer immediately (never diverges), while
  a locally-painted pixel is _shown_ on top for 100 ms. Driven live: a colliding remote
  colour stayed suppressed through 60 ms, revealed at ~123 ms, and converged byte-identical
  to the server.
- **A convergence harness** (`shared/utils/__tests__/convergence.test.ts`) now asserts N
  clients end byte-identical to the server — and found a pre-existing patch-replay divergence
  that was fixed as part of the phase.

Sync-model risk called out below was real: the patch-replay fix and the cold-room join race
both surfaced here. Convergence is tested explicitly (unit harness + a byte-compare in the
smoke test + a live browser drive), not just delivery.

### ✅ Phase 4 — Per-room canvas resize

Canvas dimensions moved from compile-time constants to a per-room `CanvasDims`
(`shared/constants/canvas`), threaded through every index/bounds/validation/apply function
in `shared/`. New rooms default to **256×256**; a room may be resized within **[16, 512]**
(owner-only, `resize` socket message, crop/pad from top-left per §16, forcing a resync).
The snapshot row is authoritative for a room's size; `resizePixels` does the crop/pad; a
migration adds CHECK constraints on every stored dimension. `maxPayload` rose to 4 MiB to
fit the largest full-canvas undo. The client adopts a live resize from the snapshot header
and resets its undo stacks (stale byte indices) via `canvasResetKey`. Landed in three
commits: the mechanical parameterisation, the per-room wiring, and the resize operation.

### ✅ Phase 5 — UI redesign (**large**)

Retractable **right** sidebar, desktop and mobile, with three tabs:

- **Drawing** — square icon dropdown of tools (tooltips carry name + shortcut), undo/redo,
  primary/secondary colour inputs with a swap button (the primary sits raised), then a
  contextual panel per tool (e.g. stroke width for pencil/eraser).
- **Room** — connected count, collapsible name list, claim/**release** ownership button
  (one transforms into the other), guest-draw toggle, clear and resize icon buttons greyed
  for non-owners, editor-request accept/deny, download icon bottom-right.
- **Timeline** — checkpoints for the owner, scrubbing for everyone.

Also: keyboard shortcuts active while open, a full ARIA pass, merge the two `relativeTime`
formatters, and route every dialog through `PopupBase`. The canvas stays pan/zoomable.

**Done.** The jsdom + Testing Library stack (§11) and the retractable sidebar shell
(roving-tabindex tablist, `inert` when collapsed) landed first, then all three tabs as
thin compositions:

- **Drawing** — a `ToolPicker` listbox (icon dropdown), undo/redo, `ColorControls`
  (primary/secondary swatches + swap), and a contextual `StrokePanel` shown only for
  stroke tools.
- **Room** — `MemberList`, `OwnershipButton`, the open-editing `Toggle`, `EditorRequests`,
  `CursorControls`, `ResizeControl` (which also finished Phase 4's resize UI), and
  clear + download. Reads permissions through the shared predicates the server enforces.
- **Timeline** — `CheckpointList` + the `PlaybackViewer` overlay.

The superseded floating components were deleted (`ToolMenu`, `ColorSelector`,
`HamburgerButton`, `PresenceRoster`, `CheckpointsPopup`); reusable primitives (`Toggle`,
`IconButton`, `LabelledSlider`) live once.

The closing refactor + a11y/cleanup pass: `App.tsx` became a thin composition root — the
tool/stroke/eyedropper, sidebar and colour-popup state clusters moved into
`useDrawingTools` / `useSidebar` / `useColorPopup` (plus a `useDisclosure` primitive),
preserving the §13.5 ref-vs-state splits. A central `useKeymap` binds the tool shortcuts
(P/E/F/S/I) while the sidebar is open plus Ctrl/Cmd+Z and Ctrl+Shift+Z; the `ToolPicker`
listbox was made genuinely keyboard-operable (arrow/Home/End/Enter/Escape + focus
management); the two `relativeTime` formatters merged into `utils/relativeTime.ts`; the
Dashboard and `PlaybackViewer` were routed through `PopupBase` so every dialog shares the
role / aria-modal / Escape / inert contract; and the floating top-right account/room
buttons became a real flex layout. The canvas stays pan/zoomable. (The Testing Library +
jsdom choice is recorded in §16.)

### ✅ Phase 6 — Timeline scrubbing + uniform decimation

Start-to-end timeline scrub for everyone, checkpoint navigation, and uniform decimation
once a room's history exceeds its cap.

- **Retention** moved from "prune to the latest snapshot" to a **two-snapshot model**: a
  genesis **base** (blank @ rev 0, seeded on room creation; the resize image after a resize)
  and the **head** (latest snapshot). Recovery still reads the head + events after it;
  playback reads the base + events after it, so the scrub covers the room start-to-end. A
  resize resets the base (the Phase 4 hard boundary). See §5.8/§6.
- **Uniform decimation** (`backend/src/db/historyDecimation.ts`) thins the retained event
  log to `MAX_HISTORY_EVENTS = 20,000` once it grows past it — evenly, keeping the first and
  last, so the whole timeline stays scrubbable at even fidelity (§16). It runs in `saveRoom`
  after the snapshot and only ever deletes events already baked into the head snapshot, so it
  **cannot affect crash-recovery** — decimation is decoupled from durability.
- **Playback** with no checkpoint replays from the genesis base; the (already-present) client
  scrubber gained **checkpoint tick-marks + prev/next-checkpoint jump for everyone**
  (restoring the board to a checkpoint stays owner/editor-gated, unchanged).
- **No wire-protocol change and no DB migration.** Verified: pure decimation + marker-math
  unit tests (fail-first); backend integration tests against Postgres (retention keeps the
  genesis base + full span, decimation bounds the count with recovery still byte-exact); a
  `smoke-test.mjs` playback probe (`baseRevision 0`, full span); and a live browser drive
  (markers at the right frames, prev/next jumps, step-0-blank-genesis → step-N-full scrub).

### ✅ Phase 6.5 — Bug-fix and polish passes

Two rounds of user-reported issues after Phase 6. Grouped here because several of them
changed load-bearing behaviour documented above, and one of them is the best worked example
in the repo of a bug that is really two bugs.

**Correctness**

- **Undo on a large stroke did nothing** — two stacked causes (recording outgrowing the
  patch cap; the rate limiter dropping the message). Full write-up in §5.4, including the
  invariant now pinned by a test. This is the one to read.
- **No-op instructions no longer enter the timeline.** Line/spray/fill report a changed-pixel
  count and the fan-in maps zero to `null` (§13.2). Verified live: repeating an identical
  stroke added 0 timeline steps where a genuinely new one added 1.
  - Caught a **probe** bug in doing so: `permissions-probe.mjs` drew the same line in the
    same colour for every role check, so its strokes became no-ops. Each stroke now lands on
    its own pixels — which is what "this role can still draw" always meant to assert.

**Structure**

- **The app opens on a lobby**, not straight into a room. `App` is a shell owning what
  outlives a room (identity, theme, which room); `Whiteboard` owns everything that only
  exists inside one. Separate components rather than a branch, so the board's hooks and its
  socket do not run while you are in the lobby. `useRoomConnection` no longer persists the
  room id — the shell does, because "which room" is now what distinguishes the two views.
- **The sidebar is organised by what you are thinking about**, not by feature: the timeline
  moved into the Room tab (a room's history is a fact about that room) and the freed tab
  holds the **Account**. Account controls had been split between the top-right corner and
  the foot of the Room tab; they are now in one place, with `PATCH`/`DELETE /api/auth/me`
  behind them. Both are scoped to the caller **by the session cookie alone** — neither takes
  a user id, because an id parameter on "rename me" is an invitation to do it to someone
  else. Deletion leans on the schema's own `ON DELETE` rules (§6): memberships go, so their
  rooms become unowned; rooms they *created* survive with `created_by` nulled.

**Presentation** (all of it var-driven, so both themes move together)

- **The palette is named by use and built complementary.** `--normal-color` was only ever a
  tooltip background and `--popup-background` painted inputs as much as popups, so names now
  say *where* a colour goes. The scheme stays warm amber but the focus ring comes from the
  opposite side of the wheel, where before an orange accent sat on a yellow ground with a
  yellow ring — all neighbours, nothing to push against.
- **Dark mode was measured, not eyeballed.** The Members role chips read **1.15:1** against
  their own label (a nonexistent `--tag-bg` plus fixed pastels, so a light chip carried the
  theme's light text); now 11.4 / 5.3 / 8.0:1. The grid was 1.12:1 and is now 1.31:1 — dark
  surfaces need a *wider* absolute gap than light ones for the same apparent softness.
- **Native controls follow our theme.** `color-scheme` was `light dark`, which defers to the
  OS — so on a dark-mode machine every slider rendered dark while the app was in light mode.
- **Dialogs are bounded to the viewport** (`dvh` with a `vh` fallback; the colour picker's
  action bar is sticky). Nothing capped their height before, so the picker ran off a short
  screen with Apply unreachable.
- **Interaction has direction**: hover lightens, press moves the other way, so the two can
  never be confused. The tab underline slides; swapping the palette animates the two swatches
  trading places. All of it off under `prefers-reduced-motion`.

**Input**

- **The wheel zooms again**, except while a slider holds focus — selecting a tool focuses its
  size slider, so the wheel sizes the brush until you draw, and shift+wheel zooms meanwhile.
  Focus rather than hover, because you are over the *canvas* when you want to size a brush.

> **Environment note for whoever verifies next.** The in-app preview browser used here does
> not run animation frames — `requestAnimationFrame` never fires and screenshots time out —
> so CSS transitions never advance and `getComputedStyle` can return stale values mid-flight.
> Static endpoints are checkable there; **motion is not**. Two-socket Node probes turned out
> to be both faster and stronger evidence for anything protocol-level (see the cursor-tool
> probe pattern in §11).

### Phase 7 — Real-world Usablity

Detail how to implement this in a real sever and run on multiple devices. Implement anything needed
for real-world productivity and explain how to start running it online. Alter the README.md with new images
and text detailed how everything work, how to use it, and how to run it on your computer (local or on a sever).

### Phase 8 — Fundamentals writeup

How every change works at a fundamental level: the crypto and what each part defends
against, why the 100 ms hold preserves convergence, where the bytes go, the permission
model, how is auth and tokens handled, how data is compressed, and the decimation maths.
Written to be defensible in an interview.
