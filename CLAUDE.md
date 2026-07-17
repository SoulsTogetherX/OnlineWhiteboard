# OnlineWhiteboard — Architecture & Working Notes

> Context document for AI-assisted work on this repo. Written 2026-07-16.
> Every claim marked **[verified]** was confirmed by running the stack, not inferred.
> Lives at the repo root so Claude Code auto-loads it.

## Changelog

**2026-07-17 — durable persistence (event sourcing) + Kysely + DB migrations.**
Delivered in four verified stages. Data model went from one `canvases` blob table
to `rooms` + `canvas_snapshots` + `draw_events`.

- **Kysely** (typed SQL query builder) replaces raw `pool.query`. `backend/src/db/schema.ts`
  is the hand-written `Database` interface every query is checked against; keep it in sync
  with the migrations by hand (or adopt kysely-codegen later).
- **Migrations** own the schema now — `backend/src/db/migrations/00N_*.ts` (raw SQL via the
  `sql` tag), registered EXPLICITLY by import in `migrate.ts` (a static provider, because the
  esbuild prod bundle has no migration files on disk for `FileMigrationProvider` to scan).
  They run on startup before `listen`. The old `database/notes_table.sql` initdb script and
  `ensureCanvasTable()`-on-every-save are both gone; `database/Dockerfile` is now stock
  Postgres.
- **Event sourcing = point 3 (no data loss).** Every applied instruction is appended to
  `draw_events` (batched flush every 250 ms; `RoomManager.flushEvents`). Recovery in
  `getOrCreateRoom` = latest snapshot + replay events with `revision > snapshot.revision`,
  through the SAME `applyDrawInstructionToCanvas` the live path and the unit tests use.
  Verified: `docker kill` mid-draw (no snapshot) recovers via replay; hard-crash loss window
  is one flush (~250 ms) instead of the 15 s snapshot interval.
- **Graceful shutdown** (closes the old gap): `SIGTERM`/`SIGINT` → `RoomManager.shutdown()`
  flushes every room's buffer + writes a final snapshot before exit. `server.close` +
  `pool.end`. Only works because the Dockerfile runs `node` as PID 1. Verified: `docker stop`
  returns in <1 s, logs "draining rooms" → "Shutdown complete".
- **Compaction** (Stage 4): `saveCanvas` now, in ONE transaction, upserts the room, writes
  the snapshot, prunes older snapshots, AND deletes `draw_events` with `revision <=` the
  snapshot's. Bounds the log to ~one save interval of drawing. Atomic so events are only
  trimmed once their replacement snapshot is committed. Tradeoff: discards history older than
  the last snapshot (fine for a whiteboard; keep events unpruned if you ever want time-travel).
- **Tests:** 71 unit (shared/, unchanged) + **15 backend integration** against a real
  Postgres (`backend/src/db/__tests__/*.test.ts`, Vitest, `backend/vitest.config.ts`). Gated
  on `POSTGRES_PASSWORD` being set so `npm test` stays green with no DB. CI's `verify` job
  gained a `services: postgres` container; run locally against a throwaway
  `docker run -p 55432:5432 postgres`.
- **Fixed in passing:** `.env` had CRLF line endings, so Compose stored the Postgres password
  WITH a trailing `\r`. The app worked only because the backend read the same CRLF file; any
  clean client (host test, CI) failed auth. Added `.gitattributes` (force LF) and normalised
  the local `.env`.
- **Gotcha for future work:** node-postgres does NOT serialise a JS object for a JSONB column
  on INSERT (hand it `JSON.stringify`) but DOES parse it on SELECT. That asymmetry is encoded
  in `draw_events.instruction`'s three-arm `ColumnType` in `schema.ts` — get it wrong and it's
  a runtime error, not a type error. Also: `db.destroy()` ends the pool; don't also call
  `pool.end()`. And a native Windows Postgres on `:5432` shadows the Docker one for HOST
  connections (not for the app, which uses the Docker network) — use a throwaway on a free
  port for local integration runs.

**2026-07-16 (later still) — two bugs, both found from one dev-loop symptom.**
71 tests now.

**A. Messages sent before a room finished loading were silently dropped.**
`RoomManager.addClient` registered its `socket.on("message")` listener *after*
`await this.getOrCreateRoom(roomId)` — an await that hits Postgres. Anything the
client sent during that window had no listener, and `ws` discarded it.

Not a rare race: clients ping the instant the socket opens, and a room only
loads from the DB when it is **not** cached — i.e. for the first client into any
room, every time. Observed loop: ping dropped → no pong → the client's 5s
heartbeat timeout → close 4000 → reconnect → but that client leaving evicted the
room from the cache → cold again → same race. Three cycles (~14s) before it
happened to win. **In production this silently dropped a user's first strokes.**

Fix: attach every listener synchronously before the await, buffer arrivals
(capped by `MAX_PENDING_MESSAGES`), drain in order once ready. Same function had
a leak: a client disconnecting mid-load never fired `removeClient` (its close
listener wasn't attached yet), and its dead socket was then added to the room —
leaving a room that could never empty, with its save/snapshot timers running
forever. `disposeIfEmpty` is now the single place those timers stop.
Verified: heartbeat timeouts 3 → **0**, recovery ~14s → ~1.9s.

> The `[vite] ws proxy error: ECONNREFUSED` that surfaced this is **expected, not
> a bug** — editing `shared/` restarts the backend (tsx) while the frontend
> HMRs, so for ~1s there is genuinely nothing listening on `backend:3000`. One
> line per restart is honest reporting. What was broken was the reconnect loop
> hiding behind it.

**B. Strokes stopped short of the canvas edge.** See §4.8.

**2026-07-16 (later) — tests + bug sweep.**

- **Vitest at the repo root** (`npm test`): 51 tests over `shared/utils/*`.
  Tests live in `shared/utils/__tests__/`, next to the code. Root
  `package.json`/`vitest.config.ts` exist ONLY for this — it is not an npm
  workspace. `npm run typecheck:shared` is a third opinion on shared/.
- **`shared/utils/validateInstruction.ts`** — runtime validation at the single
  fan-in point (`applyDrawInstructionToCanvas`). See §9-security.
- **ESLint: 28 problems → 0.** All 4 packages typecheck; `loadtest/` un-ignored.

Fixed (see §9 for the full detail on each):
| # | Bug | Why it mattered |
|---|---|---|
| 1 | **DoS**: `setPixelLine` had no bounds check | A `nextPos: [1e9, 1e9]` froze the event loop for every room. Synchronous, so uninterruptible — it hung the _test runner_ too. |
| 2 | Backend crash-loop on any DB error | `void addClient(...)` → unhandled rejection → process death → every user in every room dropped. |
| 3 | Mobile hamburger couldn't open the toolbar | Click bubbled to the wrapper's close handler; same batch, last write wins. |
| 4 | Secondary color picker edited primary | `currentColor` hardcoded to `"primary"`. |
| 5 | Color swap never persisted | Bypassed `useColorPalette`, mutated the ref in place. |
| 6 | `useSessionID` watched the wrong storage key | Cross-tab sync could never fire. |
| 7 | `useDrawActions` captured `canvasRef.current` at render | Null on first render; drawing worked only after an unrelated re-render. |
| 8 | `getVecFromIdx` dead **and** wrong | Missing the `>> 2`; deleted. |
| 9 | `express.json()` registered twice | The intended 2mb limit never applied. |
| 10 | `.gitignore`'s blanket `*.js` | Hid `frontend/eslint.config.js` from the repo entirely. |
| 11 | loadtest `npm run run` a no-op on Windows | `file://${argv[1]}` never matches `import.meta.url` on win32. |
| 12 | loadtest didn't typecheck | Missing `instructionId`/`sessionId`; `tsx` strips types unchecked. |

Also: active-tool indicator added (was impossible — see §4.7); `inert` on closed
popups/toolbar; accessible names on every control; Escape closes popups;
`useMediaQuery` unified the toolbar's React state with its CSS.

**NOT fixed / deliberately left:** the `Pallet`/`Protocall` spelling (§10 — needs
one atomic sweep), Redis-backed rooms (§12.11), graceful shutdown (§12.5).

**2026-07-16 — production build path added.** The repo previously had no production
pipeline at all (see §7.4, now resolved). Added:

- Multi-stage `frontend/Dockerfile` (`deps` → `dev` | `build` → `prod`) with nginx
- Multi-stage `backend/Dockerfile` (`deps` → `dev` | `build` → `prod`) with esbuild
- `frontend/nginx.conf.template` — replaces Vite's dev proxy in production
- `docker-compose.prod.yaml` — standalone production stack
- `GET /api/health` for container/platform probes

Fixed along the way (each surfaced _by_ the production build):

- **Frontend did not typecheck.** `tsc -b` failed with 2 errors; only `npm run build`
  runs it, and Docker never called `npm run build`. Root cause was `DrawAction` and
  `*Instruction` sharing one position type — now split (§4.6).
- **Backend crash-loop on any DB error.** `void roomManager.addClient(...)` turned a
  rejection into an unhandled rejection, killing the whole process and every connected
  user. Now caught, closing only the offending socket with code 1011.
- **`express.json()` registered twice**, so the intended 2mb limit never applied.
- **`.gitignore`'s blanket `*.js`** silently excluded `frontend/eslint.config.js` from the
  repo — a fresh clone had a broken `npm run lint`.
- **Docker layer cache** — frontend copied source before `npm install`, so any edit
  re-downloaded every dependency.

Still open: everything in §9 except the items above.

---

## 1. What this project is

A real-time collaborative pixel whiteboard. Users join a **room** by id, draw on a shared
120×120 canvas, and every stroke propagates live to everyone else in that room. Canvas
state survives disconnects — it is periodically persisted to PostgreSQL.

The defining architectural decision: **the server owns an authoritative pixel buffer**,
not a list of shapes. Everything else follows from that.

---

## 2. Tech stack

| Layer         | Choice                        | Version                                | Notes                                         |
| ------------- | ----------------------------- | -------------------------------------- | --------------------------------------------- |
| Frontend      | React + Vite                  | React 19.2, Vite 8.1                   | No router, no state library, no CSS framework |
| Backend       | Express + `ws`                | Express 5.2, ws 8.21                   | Raw `ws`, **not** Socket.IO                   |
| Database      | PostgreSQL                    | 18-alpine                              | Single `canvases` table                       |
| Language      | TypeScript                    | FE ~6.0, BE ^5.8                       | **Different TS versions per package**         |
| Runtime       | Node                          | FE image 24-alpine, BE image 22-alpine | **Mismatched on purpose? Probably not**       |
| Dev runner    | `tsx watch` (BE), `vite` (FE) | —                                      | Backend is never compiled; tsx strips types   |
| Orchestration | Docker Compose                | —                                      | 3 services: frontend, backend, database       |
| Load testing  | Custom `ws` harness           | —                                      | `loadtest/` — **gitignored**, see §11         |

**Not present, deliberately worth knowing:** no tests of any kind, no CI, no linting on
backend, no auth, no rate limiting, no production build path (see §7.4).

---

## 3. Repository layout

```
OnlineWhiteboard/
├── CLAUDE.md               # this document — architecture notes, auto-loaded
├── docker-compose.yaml      # DEV stack (Vite HMR + tsx watch)
├── docker-compose.prod.yaml # PROD stack (nginx + compiled backend), standalone
├── .env / .env.example     # ALL ports + hostnames come from here
├── frontend/               # React + Vite SPA
│   ├── vite.config.ts      # aliases + DEV proxy — read this first
│   ├── nginx.conf.template # PROD proxy — must mirror vite.config.ts's proxy
│   ├── Dockerfile          # multi-stage: deps -> dev | build -> prod
│   └── src/
│       ├── main.tsx        # StrictMode root
│       ├── app/App.tsx     # composition root; wires every hook
│       ├── components/     # 8 components, each folder = index.tsx + styles.css
│       ├── hooks/          # the actual logic lives here
│       └── constants/ui.ts
├── backend/                # Express + ws
│   └── src/
│       ├── server.ts       # entry: express + http + WebSocketServer
│       ├── routes/         # nearly empty — one stub POST /api
│       ├── sockets/
│       │   ├── index.ts    # HTTP->WS upgrade gate
│       │   └── roomManager/index.ts   # ★ the heart of the app
│       └── db/             # pool.ts + canvasRepository.ts
├── shared/                 # ★ imported by BOTH frontend and backend
│   ├── types/              # protocol contracts
│   ├── constants/canvas/   # CANVAS_WIDTH/HEIGHT/BYTES
│   └── utils/              # the draw algorithms — run on BOTH sides
├── database/               # Dockerfile + notes_table.sql
└── loadtest/               # standalone ws load harness (gitignored)
```

### The `shared/` folder is the most important idea in the repo

`shared/utils/*` contains the **pixel-mutation algorithms** (Bresenham line, flood fill,
CAS patch). Both the browser and the Node server import and execute the _same source
file_. This is why the server can maintain an authoritative canvas that provably matches
what clients render — there is one implementation, not two that must be kept in sync.

This is the single strongest talking point in this codebase for an interview.

**How `shared/` is wired (three separate mechanisms — know all three):**

1. **Frontend build**: `vite.config.ts` → `resolve.alias["@shared"] = ../shared`
2. **Type checking**: `tsconfig.app.json` / `backend/tsconfig.json` → `paths: {"@shared/*": ["../shared/*"]}`
3. **Backend runtime**: `tsx` reads `paths` from `backend/tsconfig.json` and resolves at import time

`shared/` is **not** an npm package — no `package.json`, no workspaces. It is joined
purely by path aliases. In Docker this works because of a neat trick: both containers
have `WORKDIR /app`, and compose mounts `./shared:/shared`. So `../shared` from `/app`
resolves to `/shared`. **[verified]**

> **Fragility to know:** because there is no workspace, `shared/` is invisible to
> `npm install`, has no independent typecheck, and the loadtest's copy of the types has
> already silently drifted out of date (§11).

---

## 4. How it works — the runtime story

### 4.1 Joining a room **[verified by live probe]**

```
Browser                                  Server
  |-- GET /ws?roomId=X  (HTTP Upgrade) --->|  sockets/index.ts
  |                                        |  reject unless pathname==="/ws" && roomId
  |<---------- 101 Switching --------------|
  |                                        |  roomManager.addClient()
  |                                        |  getOrCreateRoom(X):
  |                                        |    cache hit? -> reuse
  |                                        |    miss -> loadCanvas(X) from Postgres
  |<-- {type:"ready", revision, activeUsers}
  |<-- {type:"canvas_snapshot", data:<base64 57600B -> 76800 chars>}
  |<-- {type:"presence", activeUsers}      |  broadcast to whole room
```

Observed exactly this sequence, in this order, with `b64len=76800`. **[verified]**

### 4.2 Drawing **[verified]**

```
Client                                   Server
  pointerdown/move
  -> useDrag -> useCanvasDrawing -> useDrawActions
  -> handleDrawLineStart/Motion  (paints LOCALLY, optimistically)
  -> returns DrawInstruction
  |-- {type:"draw", roomId, instruction} ->|
  |                                        | applyDrawInstructionToCanvas(room.pixels, inst)
  |                                        | room.revision += 1; room.isDirty = true
  |<-- {type:"draw", instruction, revision} -- broadcast to ALL incl. sender
  other clients apply it to their ImageData
```

Note the client paints **before** the server confirms (optimistic local echo), and the
sender also receives its own stroke back. The sender ignores nothing — it re-applies its
own stroke idempotently (drawing the same pixels the same color is a no-op).

### 4.3 The revision heartbeat — a genuinely good optimization

Every 10s the server broadcasts `{type:"revision_check", revision}` — a few dozen bytes.
Each client compares against its own `lastRevision`. Only a client that has **fallen
behind** sends `{type:"resync"}`, and only that client gets a fresh 75KB snapshot.

The comments in `shared/types/socketProtocol.ts` say this replaced an older design that
broadcast the full canvas to everyone every 10s. That's O(clients × 75KB) every 10s →
now O(clients × ~40B). **This is the best perf story in the repo — know it cold.**

> ⚠️ The `loadtest/README.md` still documents the OLD behavior and its headline finding
> no longer reproduces. The harness ignores `revision_check` and never sends `resync`, so
> **it does not exercise the new snapshot path at all.**

### 4.4 Undo/redo — compare-and-swap patches **[verified: CAS rejection works]**

This is the most sophisticated part of the codebase.

- While drawing, `withRecording()` (`helperProtocallMethods.ts`) wraps the pixel-setter so
  every write also records `{idx, from, to}` — the undo entry is built **for free** off
  the same loop that paints. No separate diffing pass.
- On gesture end, `useDrawActions` calls `onCommitAction(instructionId, entries)` →
  `useUndoRedo.pushAction()`.
- Undo reverses the entries (`from`↔`to`) and sends a `PatchInstruction`.
- `handleDrawPatchInstruction` applies each entry **only if the pixel currently equals
  `from`**. Anything someone else painted over is skipped.
- The applied _subset_ is returned, so the server broadcasts only what really landed, and
  the client pushes only what really landed onto the redo stack — and tells the user
  ("Undo only partially applied — someone else drew over part of it").

I verified the CAS: sending a patch with a deliberately wrong `from` produced **no
broadcast at all** — correctly rejected. **[verified]**

Why this matters: naive undo in a collaborative app would clobber other users' work.
This design makes undo _safe under concurrency_ without needing full OT/CRDT machinery.
It is the second-strongest interview talking point.

Stack caps are dual (`useUndoRedo.ts`): `MAX_ACTIONS = 50` **or** `MAX_BYTES = 64KB`,
whichever hits first — because a long scribble is many actions/few entries while a bucket
fill is one action/many entries. Neither cap alone bounds both shapes.

### 4.8 Off-canvas strokes: RAW positions + clipping (don't "simplify" this)

`LineAction.prevPos/nextPos` hold **raw, possibly off-canvas** pointer positions.
`handleDraw` clips the segment with `clipSegmentToCanvas` (Liang–Barsky) and
draws/sends only the clipped part. Three things depend on that split:

1. **The stroke reaches the edge.** `handleDraw` used to `return null` whenever
   the pointer was outside, so a stroke ended at the last in-bounds *sample*,
   visibly short of the edge.
2. **Clipping ≠ clamping.** Clamping each axis independently sends (200, 60) to
   (119, 60), but the segment from (50, 50) actually leaves the canvas at
   (119, 55). Clamping bends the line; for a fast flick at a corner it's obvious.
   There is a test asserting exactly this.
3. **Re-entry is correct.** Coming back on-screen, the segment starts where the
   real line crosses the edge — computable only from the raw off-canvas
   position. Store a clamped value and the return stroke kinks.

The wire instruction is built from the **clipped** endpoints, never from `da`'s
raw ones — `validateInstruction` requires in-bounds coordinates and would (
correctly) drop the raw form.

> **Why `handleDrawLineLeave` is the wrong place to fix this** — a natural first
> attempt, and it cannot work. `useDrag` calls `element.setPointerCapture()` on
> pointerdown, and while a pointer is captured the browser does **not** fire
> `pointerleave` on the element when the pointer moves off it (capture makes the
> element the hit-test target for everything; leave fires at release). So the
> leave handler never runs mid-drag. The fix has to live on the `pointermove`
> path, which is what `handleDraw` is.

`getPosCorrected` still exists and is still right for the **bucket** tool: a
fill clicked outside the canvas should be ignored, not clipped.

### 4.7 The tool/palette ref-vs-state split (read before touching ToolMenu)

The selected tool lives in **both** a ref and state, in `App.tsx`, on purpose:

- the **ref** (`drawAction`) is what the pointer handlers read on every event, so
  changing tools never re-subscribes the drag listeners;
- the **state** (`selectedTool`) is what lets the toolbar render the active tool.

`App` owns both and passes `selectedTool` + `onSelectTool` down. `ToolMenu` used
to receive the ref and write to it — mutating a prop, and the reason the active
tool could never be shown (a ref write triggers no re-render, so there was no
`.active` style because the feature was _impossible_).

`colorPallet` is still a ref (`useSessionStorageRef`), so `ColorSelector` keeps a
local `isSwapped` boolean purely as a render trigger. Note the swatch `<button>`s
deliberately carry **no `key`**: React reconciles them by index, reuses both DOM
nodes and only swaps their `top`/`bottom` class, which is what animates the
slide. Adding keys reorders the nodes instead and kills the animation.

### 4.6 Action vs Instruction — the type distinction (fixed 2026-07-16)

These two look interchangeable and are not:

- **`DrawAction`** = a gesture _in progress_. The toolbar creates one holding nothing but
  `{ type: "pencil" }`, and the pointer handlers mutate positions into it as the gesture
  runs. Positions are therefore `Partial`.
- **`DrawInstruction`** = a _completed_ fact headed for the wire. Positions are guaranteed,
  plus `instructionId` + `sessionId` from `BaseInstruction`.

Originally both derived from one `*Shared` type with **required** positions, which made
`{ type: "pencil" }` fail to typecheck and left the defensive guards in the handlers
(`if (!action.prevPos ...)`, `action.pos ?? [0,0]`) unreachable. Nobody noticed because
`tsc -b` never ran (§7.4). Now split via `Partial<PencilPositions>` vs `PencilPositions`.

Note the union assignability subtlety: `{ type: ToolType }` is only assignable to the
`DrawAction` union because TypeScript expands a union-typed discriminant across the
union's members — and that only works once the _other_ properties are optional. Making
positions required again would break `ToolMenu.setTool` immediately.

### 4.5 Persistence

- `saveTimer` per room: every 15s, `if (isDirty)` → `saveCanvas()` (`INSERT … ON CONFLICT
DO UPDATE`, i.e. upsert).
- Last client leaves → final save, timers cleared, room **evicted from memory**.
- `loadCanvas` returns a blank canvas if dimensions don't match — so changing
  `CANVAS_WIDTH` silently discards every existing drawing.

---

## 5. Docker — what it is and how it's used here

### What Docker is (for the writeup/interview)

A **container** packages an app with its dependencies and a minimal filesystem, and runs
it as an isolated process on the host kernel. Unlike a VM there's no guest OS — startup is
milliseconds and overhead is near zero. Key nouns:

- **Image** — an immutable, layered filesystem snapshot built from a `Dockerfile`. Each
  instruction is a cached layer; changing one invalidates everything after it.
- **Container** — a running instance of an image.
- **Volume** — persistent storage that outlives containers (images are ephemeral).
- **Bind mount** — maps a host directory into the container; edits on the host appear
  instantly inside. This is what makes hot-reload work in dev.
- **Compose** — declares a multi-container app in one YAML, on a shared virtual network
  where services address each other **by service name as hostname**.

### How it's used here

Three services in `docker-compose.yaml`:

**`database`** — `postgres:18-alpine`. `notes_table.sql` is copied into
`/docker-entrypoint-initdb.d/`, a Postgres convention: scripts there run **only on first
init of an empty data directory**. Data lives in the named volume `database-v`.

- A `healthcheck` runs `pg_isready`; `backend` uses `depends_on: condition:
service_healthy` so it never starts against a database that isn't accepting connections.
  This is the _correct_ way to sequence — plain `depends_on` only waits for _start_, not
  readiness.

**`backend`** — build context is the **repo root** (not `./backend`) so the Dockerfile can
reach `shared/`. Runs `tsx watch src/server.ts`. `./backend/src:/app/src` and
`./shared:/shared` are bind-mounted for hot reload.

**`frontend`** — same context trick. Runs the **Vite dev server** (see §7.4 — this is
also the "production" path, which is a problem).

**The `/app/node_modules` anonymous-volume trick** (in both): bind-mounting
`./frontend/src` is fine, but if you mounted the whole folder the host's (possibly absent
or OS-wrong) `node_modules` would shadow the image's. Listing `/app/node_modules` as an
anonymous volume masks the host copy and keeps the container's own installed deps. Common
and worth being able to explain.

**Env indirection:** every port/hostname comes from `.env`. `container_name:
${BACKEND_HOST}` = `server-c`, and `VITE_API_BASE: "http://backend:${BACKEND_PORT}"`
resolves via Compose's DNS. Note the subtlety: `VITE_API_BASE` uses the **service name**
`backend`, not the container name `server-c`.

**`CHOKIDAR_USEPOLLING=true`** — file-watch events don't cross the Windows/WSL2 boundary
reliably, so watchers poll every 300ms instead. Costs CPU; necessary on Windows.

**`develop.watch` + `action: rebuild`** — Compose Watch rebuilds the image when
`package.json`/`Dockerfile` change (source is already live via bind mount). Requires
`docker compose watch`, not plain `up`.

### ⚠️ Postgres 18 changed PGDATA — do not "fix" the volume mount

`PGDATA` in `postgres:18-alpine` is **`/var/lib/postgresql/18/docker`**, _not_ the classic
`/var/lib/postgresql/data` **[verified]**. Both compose files therefore mount the **parent**
`/var/lib/postgresql`, which keeps the versioned directory inside the volume.

"Correcting" this to `/var/lib/postgresql/data` looks right, matches every pre-18 tutorial,
and **silently persists nothing** — Postgres would write to the container's ephemeral layer
and every canvas would vanish on restart, with no error anywhere. Verified that a canvas
survives `down`/`up` with the current mount.

### Docker weaknesses — status

Fixed 2026-07-16:

- ~~Frontend `node:24-alpine` vs backend `node:22-alpine` drift~~ → both `node:22-alpine`.
- ~~No multi-stage build / `NODE_ENV=production` / non-root `USER` / healthchecks~~ → all
  present in the `prod` targets.
- ~~`COPY ./frontend .` before `RUN npm install` busting the cache~~ → manifests are copied
  first, and `npm ci` replaces `npm install` for reproducibility.
- ~~`database` publishes 5432~~ → still published in **dev** (convenient, and the loadtest
  needs 3000); **not** published in prod. Prod exposes only nginx on `PROD_PORT`.

Still open:

- `POSTGRES_PASSWORD` reaches containers via compose `env_file`, so it's in the process
  environment. Fine for local/self-hosted; use Docker secrets or a managed DB for anything
  real.
- No `.env` validation — a missing var fails at connect time with an opaque error.

### container_name vs service name vs network alias (bit me — read this)

Compose gives a container **three** possible DNS names on its network:

1. the **service name** (`backend`, `database`) — always an alias, always works;
2. the **`container_name`** if set (`postgres-c`) — _global to the Docker daemon_, so two
   stacks can't both use it;
3. explicit **network aliases** — scoped to that project's network.

`backend/src/db/pool.ts` dials `POSTGRES_HOST` (= `postgres-c`). Dev gets that name for
free from `container_name: ${POSTGRES_HOST}`. The prod stack deliberately omits
`container_name` (so it can run alongside dev), which broke DNS → `ENOTFOUND postgres-c` →
the backend crash-looped. Fixed with a **network alias** on the prod `database` service.

If you ever add a third stack, or rename a service, check this first.

---

## 6. The `.env` contract

```
API_BASE=http://localhost          PUBLIC_SITE_URL=http://localhost:5173
FRONTEND_HOST=frontend-c           FRONTEND_PORT=5173
BACKEND_HOST=server-c              BACKEND_PORT=3000
POSTGRES_HOST=postgres-c           POSTGRES_PORT=5432
POSTGRES_USER=postgre              POSTGRES_PASSWORD=<set me>   POSTGRES_DB=info_db
```

`.env.example` → rename to `.env`, set `POSTGRES_PASSWORD`, then `docker compose up
--build`. App at `http://localhost:5173`.

Gotcha: `pool.ts` reads `POSTGRES_HOST` etc. from the process env — supplied by
`env_file: .env` on the backend service. There is **no validation**; a missing var fails
at connect time with an opaque error.

---

## 7. Vite — deep dive

### 7.1 What Vite is and why it exists

Vite is a frontend build tool with **two completely different engines**, and understanding
that split is the whole point:

**Dev — native ESM, no bundling.**
Older tools (Webpack, CRA) bundled your entire app before serving the first byte; startup
grew linearly with codebase size. Vite instead serves your source as **native ES modules**
straight to the browser. The browser's own `import` statements pull modules on demand.
Vite only transforms the specific file requested (stripping TS types, compiling JSX) —
per-file, on demand, cached. That's why it started in **1013 ms** here **[verified]**, and
why that number barely moves as the app grows.

Two supporting pieces make that viable:

- **Dependency pre-bundling** (esbuild, Go — 10–100× faster than JS bundlers). `react` ships
  as many small CJS/ESM files; unbundled, the browser would fire hundreds of requests. Vite
  pre-bundles deps once into `node_modules/.vite/deps/` and converts CJS→ESM. You can see
  it in the transformed output: `import __vite__cjsImport0_react from
"/node_modules/.vite/deps/react.js?v=fcf04d2d"` **[verified]**. The `?v=` hash is a cache
  key — bump deps, hash changes, browser refetches.
- **HMR over native ESM** — swap one module in place, keep app state.

**Prod — Rollup bundling.**
Native ESM in production means a request waterfall over the network. So `vite build` uses
**Rollup** for tree-shaking, code-splitting, minification, hashed filenames. Dev and prod
are therefore _different pipelines_ — the classic Vite footgun (something can work in dev
and break in build).

### 7.2 How Vite is used in THIS project

`frontend/vite.config.ts` is small but every line earns its place:

```ts
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const backendTarget = env.VITE_API_BASE || "http://localhost:3000"
  return {
    plugins: [react()],
    resolve: { alias: { "@": "./src", "@shared": "../shared" } },
    server: {
      proxy: {
        "/api": { target: backendTarget, changeOrigin: true },
        "/ws": { target: backendTarget, changeOrigin: true, ws: true },
      },
    },
  }
})
```

**(a) Function form + `loadEnv`.** Config is a function of `{mode}` so it can read env at
config time. `loadEnv(mode, cwd, "")` — the third arg is the **prefix filter**, and `""`
means _load everything_, not just `VITE_`-prefixed vars. Important distinction:

- Vars exposed to **client code** via `import.meta.env` must be `VITE_`-prefixed. That
  prefix is a **security boundary** — it prevents `POSTGRES_PASSWORD` from being inlined
  into a public bundle.
- `loadEnv(..., "")` in _config_ bypasses the filter, but config runs in Node, so nothing
  leaks to the client. That's legitimate — just know the difference if asked.

**(b) `@vitejs/plugin-react`.** Uses Babel to inject the JSX transform and **React Fast
Refresh** (state-preserving HMR for components). `jsx: "react-jsx"` in `tsconfig.app.json`
means the automatic runtime — no `import React` needed.

**(c) Aliases — the monorepo glue.** `@` → `./src` kills `../../../` chains. `@shared` →
`../shared` is what makes the shared-protocol architecture possible on the frontend.

> **The interesting part.** Vite has a filesystem sandbox (`server.fs.allow`) that
> normally refuses to serve files outside the project root — and `/shared` _is_ outside
> `/app`. I expected this to break. It doesn't: Vite rewrites the import to
> `/@fs/shared/utils/handleCanvasProtocol.ts` and serves it **HTTP 200** **[verified]**.
> `/@fs/` is Vite's escape hatch for exactly this (linked packages, monorepos). Worth
> knowing it's load-bearing here, because tightening `fs.allow` or changing the root would
> break the app instantly.

**(d) The dev proxy — the most load-bearing 8 lines.** The frontend calls **`/ws`**, a
_same-origin relative path_ (`useWebSocket("/ws", ...)` in `useRoomConnection.ts`). Vite's
dev server proxies it to `http://backend:3000`. This means:

- **No CORS.** Browser only ever talks to `localhost:5173`.
- **No hardcoded backend URL** in client code.
- `ws: true` opts the `/ws` route into **WebSocket upgrade proxying** — without it, the
  101 handshake is not forwarded and realtime silently dies.
- `changeOrigin: true` rewrites the `Host` header to the target.

`useWebSocket.toWebSocketUrl()` then resolves `/ws` against `window.location`, upgrading
`http:`→`ws:` / `https:`→`wss:`, and appends `?roomId=`. That's why the client works
identically on localhost and behind TLS.

### 7.3 How Vite is _meant_ to be used with React (the general pattern)

- `index.html` is the **entry point and is served as a real file** — not generated from a
  template like CRA. Its `<script type="module" src="/src/main.tsx">` is the graph root.
- `main.tsx` → `createRoot(...).render(<StrictMode><App/></StrictMode>)`.
- **StrictMode in dev double-invokes** renders/effects to surface impurity. This matters
  here: effects that mutate the canvas or open sockets run twice. `useWebSocket` guards
  with a `readyState` check — that guard is not incidental, it's what makes StrictMode
  survivable.
- Static assets: `import img from "./x.png"` returns a hashed URL; `public/` is copied
  verbatim.
- `import.meta.env.DEV / .PROD / .MODE` for env branching.
- `npm run dev` → dev server; `npm run build` → `tsc -b && vite build` → `dist/`;
  `npm run preview` → serve `dist/` locally to sanity-check the _real_ bundle.

Note `"build": "tsc -b && vite build"` — Vite's own transform **does not typecheck** (it
just strips types via esbuild). `tsc -b` is what actually enforces types. This is why the
loadtest, which runs under `tsx` with no `tsc` step, has silently broken types (§11).

### 7.4 ✅ RESOLVED — the dev-server-as-production problem

**Historical context (this was the repo's #1 problem; kept because the reasoning is the
whole point of the current design).** `frontend/Dockerfile` used to run `npm run dev` — the
_dev server_ — as the only way to run the app. That meant `vite build`/Rollup was never
exercised, the `tsc -b` typecheck never ran (which is precisely how 2 type errors
accumulated unnoticed), it shipped unminified source plus the HMR client, and — most
subtly — **the `/api` + `/ws` proxy is a dev-server feature that does not survive
`vite build`**, so the app had no production networking story at all.

**Now:** `frontend/Dockerfile` is multi-stage with a `dev` target (unchanged behavior) and
a `prod` target that runs `tsc -b && vite build` and serves `dist/` from nginx.
`frontend/nginx.conf.template` re-implements the dev proxy's `/api` and `/ws` routes —
that file is the direct production replacement for `server.proxy` in `vite.config.ts`, and
the two must be kept in agreement.

**The invariant that makes this work:** the client requests a _relative_ `/ws`
(`useWebSocket("/ws", ...)`), never an absolute URL. `toWebSocketUrl` resolves it against
`window.location` and upgrades `http:`→`ws:` / `https:`→`wss:`. So whatever origin serves
the page also proxies the socket, and **one built artifact runs in any environment with no
rebuild**. Do not "fix" this into a `VITE_WS_URL` env var — that would reintroduce a
per-environment rebuild for no benefit.

---

## 8. Frontend architecture

**React is a chrome layer around an imperative canvas.** No drawing goes through React
rendering — pixels are mutated via refs on `ImageData` and blitted with `putImageData`.
This is correct and deliberate; understand it before "fixing" anything.

`App.tsx` is a composition root wiring:

- `useCanvasMotion(frameRef, canvasRef)` — middle-drag pan + wheel zoom, written to **CSS
  custom properties** (`--drag-pos-x/y`, `--scroll-scale`) so transforms stay on the
  compositor and never trigger React renders. Nice technique.
- `useCanvasDrawing(canvasRef, drawAction, colorPallet, sendDrawInstruction, pushAction)`
- `useRoomConnection(canvasRef, closeRoom)` → `useWebSocket`
- `useUndoRedo(canvasRef, sendDrawInstruction)`
- `useColorPalette()` → `useSessionStorageRef`

**Hook layering (clean, worth preserving):**

```
useDrag / useScrollWheel      <- raw pointer/wheel events, pointer capture
   └─ useCanvasDrawing        <- adapts drag events to draw actions
        └─ useDrawActions     <- tool dispatch + records undo entries
             └─ shared/utils/handle*Protocall  <- the actual algorithms
```

`useWebSocket` is a hand-rolled, genuinely competent socket client: auto-reconnect with
backoff, app-level ping/pong heartbeat with pong timeout (close code 4000 = app-owned),
`beforeunload` cleanup, ref-based status to avoid render churn.

**State lives in three places with no consistent rule** — `useState`, refs-as-state
(`drawAction`, `colorPallet`), and sessionStorage. The refs are justified on the pointer
hot path but leak into the UI layer, causing the known bugs below.

---

## 9. Bugs — ALL FIXED 2026-07-16 (kept for the reasoning)

Every item below is fixed and verified. The entries stay because _why_ each one
existed is the useful part, and several encode invariants that are easy to
reintroduce.

### 9-security. Untrusted socket input (fixed)

`RoomManager.parseMessage` still does `JSON.parse(...) as ClientSocketMessage` —
an `as` cast is a compile-time assertion, **not** a runtime check. Nothing
validated the wire format.

The severe case was a **hang, not corruption**: Bresenham in `setPixelLine` is a
`while (true)` stepping one pixel at a time, so `nextPos: [1e9, 1e9]` spun for a
billion iterations. Node is single-threaded → one message froze **every room**.
And being synchronous it is uninterruptible: it hung Vitest's worker straight
through the test timeout, which is how it was found.

Now `shared/utils/validateInstruction.ts` guards `applyDrawInstructionToCanvas`
— the single fan-in point for every network instruction (server broadcast path
_and_ client receive path). Invalid → `null` → no canvas mutation, no revision
bump, no broadcast. Verified live: the hostile payload is dropped and a
legitimate stroke sent immediately after still round-trips.

`isValidVec` uses `Number.isInteger`, which rejects NaN/Infinity/fractions in one
go. A patch `idx` must also be 4-byte aligned, or one color would smear across
two pixels' channels. A patch is rejected **wholesale** if any entry is bad —
half-applying it would desync the sender's undo stack from the canvas.

> Zod at the socket boundary would still be worth adding for the message
> _envelope_ (`type`/`roomId` shape). This covers the instruction payload, which
> is the part that reaches the pixel writers.

### The rest (all fixed)

1. **Hamburger cannot open the toolbar (mobile is broken).** `App.tsx:97` sets
   `isToolbarOpen(true)`; the click bubbles to `.app-wrapper`'s `onClick` at `App.tsx:90`
   which sets it `false`. Same render batch → last write wins → `false`. Masked on desktop
   because `ToolMenu/styles.css` forces the menu visible ≥1024px. **The README advertises
   mobile support; mobile toolbar is unreachable.**
2. **Secondary color edits the wrong color.** `App.tsx:120` hardcodes
   `currentColor={colorPallet.current["primary"]}` while `onApply` writes to
   `selectedColor`. Open secondary → shown primary's values → Apply → writes primary's
   values into secondary. Fix: `colorPallet.current[selectedColor]`.
3. **Color swap isn't persisted.** `ColorSelector.swapHandler` mutates the ref in place,
   bypassing `useColorPalette.swapColors()` (which persists to sessionStorage and is
   **never imported — dead code**). Swap survives until reload, then reverts.
4. **No active-tool indicator.** `drawAction` is a ref → selecting a tool triggers no
   re-render → the toolbar physically cannot show selection. There is no `.active` style.
   Direct cost of ref-as-state. (README lists this as a wanted feature.)
5. **Closed popups/toolbar stay tab-focusable.** Hidden via `opacity: 0` /
   `translateX(-100%)`, which do **not** remove elements from the a11y tree or tab order.
   Keyboard users tab into invisible controls. No `inert`/`aria-hidden`/`display:none`.
6. **`RoomPopup` never re-syncs its input.** `useState(roomId)` only seeds at mount, and
   `PopupBase` never unmounts children (`isOpen` only toggles a class). Latent today
   because `roomId` is seeded synchronously from sessionStorage.
7. **`useSessionID` listens for the wrong key.** Guards `e.key === "client_uuid"` but
   writes `"online-whiteboard-session-id"`. Cross-tab sync never fires.
8. **`useDrawActions` captures `canvasRef.current` at first render** (`useCanvasDrawing`
   passes `canvasRef.current`, not the ref). Works only because the handler array is
   stashed in a ref on first render, when the canvas is already mounted. Fragile.
9. **Accessibility, broadly.** `HamburgerButton`, `ColorSelector`'s buttons, and `<canvas>`
   have **no accessible names**. No dialog role / Escape / focus trap in `PopupBase`.
   `ColorPopup`'s `<label>` wraps two inputs so the number field is unnamed. `ToolMenu` is
   the one good citizen — copy its pattern.
10. **`console.log` left in `useColorPalette.ts:62`.**
11. **Dead code:** `onColorChange` (`App.tsx:115`, no-op), `useColorPalette.swapColors`,
    `setRoomId` (returned, unused), `backend/src/sockets/staging/*` (errorHandler.ts +
    settupConnection.ts — 23 lines, **imported by nothing**), `database/Dockerfile` copies
    `notes_table.sql` **twice** (2nd COPY is redundant).
    ~~`routes/index.ts` stub~~ and ~~`express.json()` applied twice~~ — fixed 2026-07-16.

**Security / robustness (no auth by design, but worth noting):**

- **No input validation on socket messages.** `parseMessage` does `JSON.parse` and casts —
  `as ClientSocketMessage` is a compile-time lie. A malformed `instruction` reaches the
  pixel writers directly. `getIdxFromVec` does no bounds check, so a crafted `bucket`/
  `patch` idx can read/write outside the intended region of the buffer (Uint8ClampedArray
  writes OOB are silently dropped, so it's not memory-unsafe — but it's not _validated_
  either). **Add a Zod schema at the socket boundary — highest-value security fix.**
- **No rate limiting.** One client can pin a room's CPU with bucket fills.
- **Unbounded room growth.** Any `roomId` string creates a room + a DB row forever.
- `saveCanvas` runs `ensureCanvasTable()` on **every** call — a redundant DDL round-trip
  per save (the schema is already created by `notes_table.sql` at init).

---

## 10. Naming / spelling quirks (systemic — don't fix piecemeal)

- **`Pallet`** (a shipping platform) is used throughout for **`Palette`**: `ColorPallet`,
  `colorPallet`, `DEFAULT_COLOR_PALLET`.
- **`Protocall`** for **`Protocol`**: `handleLineProtocall.ts`, `handleFillProtocall.ts`,
  `helperProtocallMethods.ts` — but `handleCanvasProtocol.ts` and `handlePatchProtocol.ts`
  are spelled correctly. **Inconsistent.**
- `settupConnection.ts`, `Settup App & Sever` (server.ts) — "Setup"/"Server".
- `compairColors` → `compareColors`. `Summery Types` → `Summary`.
- Code uses `//#region` / `//#endregion` folding markers everywhere. **Match this style.**
- Style: no semicolons, double quotes, 2-space indent.

A rename sweep is a good early PR (mechanical, low-risk, visible) — but must be done in
one atomic pass across all three packages since `shared/` has no build boundary.

---

## 11. The loadtest harness (`loadtest/`)

Standalone `ws` client that speaks the real protocol. **Gitignored** (`loadtest/` in
`.gitignore`) — so it isn't part of the portfolio surface unless that changes.

```bash
cd loadtest && npm install
npm run run  -- --clients 50 --room demo --durationMs 30000
npm run ramp -- --room demo --levels 5,10,25,50,100,200
```

Genuinely smart: one process, one clock → measures **fan-out latency** (sender→receiver)
with no clock-skew problem, keyed by `JSON.stringify(instruction)` in a shared pending map.
`--sameRoom false` separates _total server capacity_ from _single-room fan-out capacity_.
Ramp mode writes CSV after each level and fail-fasts on the knee.

**Problems:**

- **`npm run run` is a silent no-op on Windows.** The guard
  `import.meta.url === \`file://${process.argv[1]}\`` never matches on win32
(`C:\...`vs`file:///C:/...`). Exits 0 having done nothing. Fix:
`pathToFileURL(process.argv[1]).href`. (`ramp`is unaffected — it calls`main()`
  unconditionally.)
- **Doesn't typecheck.** `randomInstruction()` omits `instructionId`/`sessionId`, now
  required by `BaseInstruction`. `tsx` strips types without checking, so it works by
  accident. No `typecheck` script.
- **README documents the old snapshot-broadcast behavior** — its headline finding no
  longer reproduces (§4.3), and the harness never exercises the current `resync` path.
- Single event loop → **coordinated omission** at high client counts; no warmup discard;
  always exits 0 so it can't gate CI.
- **Writes to real room state** — pointing it at a real room permanently scribbles on it.

---

## 12. Improvement backlog (portfolio-oriented, roughly by value)

**Tier 1 — the ones that change how the project reads to an interviewer**

1. ~~**Production build path.**~~ ✅ **DONE 2026-07-16.** See §7.4 and the Changelog.
2. ~~**Tests.**~~ ✅ **DONE 2026-07-16.** 51 Vitest tests over `shared/utils/*`
   (62% stmts / 90% branches). The uncovered remainder is the DOM-driven gesture
   handlers (`handleDrawLineStart`, `getCanvasState`, `getPos`) — they need jsdom
   plus a canvas polyfill, which is the natural next coverage step.
3. ~~**Validate socket input**~~ ✅ **DONE** for the instruction payload — see
   §9-security. Zod for the message _envelope_ is still open.
4. **CI (GitHub Actions):** typecheck all 4 packages + lint + `npm test` on PR.
   Everything it needs now exists and passes; nothing runs it automatically.
   **This is the highest-value remaining item.**
5. **Graceful shutdown.** On SIGTERM, flush every dirty room before exiting. The prod
   image already runs `node` as PID 1 (not `npm`), so the signal _does_ reach the process —
   nothing handles it yet. Currently `compose down` can lose up to 15s of drawing.

**Tier 2 — correctness** 5. ~~Fix the UI bugs (hamburger, secondary color, swap persistence)~~ ✅ **DONE**. 6. Make `shared/` a real workspace package (npm workspaces) so it has one typecheck and
the loadtest can't silently drift. (Mitigated for now: `typecheck:shared` +
the loadtest's own `typecheck` script would both have caught the drift.) 7. ~~Active-tool indicator~~ ✅ **DONE** — see §4.7. 8. Backend graceful shutdown: on SIGTERM, flush all dirty rooms. Currently `docker compose
   down` can lose up to 15s of drawing. The prod image already runs `node` as PID 1,
so the signal arrives — nothing handles it.

**Tier 3 — depth** 9. Rate-limit draw instructions per socket. 10. Binary protocol for snapshots — base64 costs +33% (57600B → 76800 chars **[verified]**).
`ws` supports binary frames natively; would cut join cost meaningfully. 11. Redis pub/sub for the room registry → lets the backend scale past one process. Right
now `rooms` is an in-process `Map`, so **the backend cannot be horizontally scaled at
all**. Good architecture talking point. 12. Accessibility pass (§9.9) — model everything on `ToolMenu`. 13. Repo-wide spelling sweep (§10).

---

## 13. Working agreements for this repo

- **Do not implement anything without explicit go-ahead.** Analysis and proposals only.
- **Changes must be incremental and testable** — one concern per change, with a stated way
  to verify it.
- **Explain every change**: what, why, and how the underlying mechanism works — the goal is
  interview-readiness, not just working code.
- Match existing style: no semicolons, double quotes, `//#region` markers, folder-per-
  component with `index.tsx` + `styles.css`.
- `shared/` has **no build boundary** — a change there hits frontend, backend, and loadtest
  simultaneously. Always check all three.
- Ask before: changing `CANVAS_WIDTH`/`HEIGHT` (silently wipes every stored canvas via the
  dimension check in `loadCanvas`), or altering the DB schema.

### Verifying a change

```bash
# DEV — Vite HMR + tsx watch
docker compose up --build                                   # http://localhost:5173
docker compose logs -f frontend
docker compose down                                         # 'down -v' also nukes the DB volume

# PROD — nginx + compiled backend. ALWAYS check a change against this too:
# dev and prod are different pipelines and can disagree.
docker compose -f docker-compose.prod.yaml up --build -d     # http://localhost:8080
docker compose -f docker-compose.prod.yaml logs -f backend
docker compose -f docker-compose.prod.yaml down
```

Run one stack at a time — they'd fight over host ports, and they use separate DB volumes.

Typecheck locally (the prod image build now does this too, so a type error fails the
build): `cd frontend && npx tsc -b --force`; `cd backend && npm run typecheck`.

Quick prod smoke test, no browser needed:

```bash
curl http://localhost:8080/api/health           # {"status":"ok",...}
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/any/route   # 200 (SPA fallback)
curl -s -m 3 http://localhost:3000/api/health   # MUST fail — backend is unpublished in prod
```

Fast protocol probe without a browser — run a `ws` script inside the backend container
(it already has `ws` installed):

```bash
docker compose exec -T backend node //app/probe.cjs   # note: // for Git Bash on Windows
```

On Windows/Git Bash, prefix docker commands that take container paths with
`MSYS_NO_PATHCONV=1` or paths get mangled to `C:/Program Files/Git/...`.

### Key files, ranked by how often you'll need them

1. `backend/src/sockets/roomManager/index.ts` — all server realtime logic
2. `shared/types/socketProtocol.ts` + `shared/types/drawProtocol.ts` — the contracts
3. `frontend/src/hooks/useRoomConnection.ts` — client message dispatch
4. `frontend/src/app/App.tsx` — composition root
5. `frontend/vite.config.ts` — aliases + proxy
6. `docker-compose.yaml` + `.env` — how it all runs
7. `shared/utils/handleCanvasProtocol.ts` — the apply-instruction fan-in point
8. `frontend/src/hooks/useUndoRedo.ts` + `shared/utils/handlePatchProtocol.ts` — CAS undo
