<p align="center">
  <a href="./LICENSE"> 
	<img alt="Static Badge" src="https://img.shields.io/badge/license-Apache%202.0-green">
  </a>
</p>

# Online Whiteboard

A real-time collaborative whiteboard web app where users can draw on a shared canvas and see updates broadcast live to everyone in the same room.
Built for desktop and mobile, with tools for freehand drawing, filling areas, and real-time collaboration.

<img width="1920" height="882" alt="Example Image" src="https://github.com/user-attachments/assets/764d1d05-62f6-45a1-9438-43840e77acf6" />

## Features

* Real-time shared drawing across users in the same room
* **Live presence** — see who else is in the room and their cursors moving in real time
* **Accounts** (optional) — draw as a guest, or sign in to get a persistent identity and a
  saved colour palette that follows you across devices
* **Full colour picker** — visual hue/saturation/value picker, recent colours, a saved
  palette, and an eyedropper that samples from the canvas
* Undo/redo that is safe under concurrent editing
* Durable canvases — survive server restarts and hard crashes with sub-second data loss
* Desktop and mobile-friendly interface
* Responsive UI for collaborative use

## Tech Stack

* Frontend: React + Vite
* Backend: Express + Node.js + WebSockets (`ws`)
* Auth: email + password (scrypt-hashed) with httpOnly cookie sessions stored server-side
* Database: PostgreSQL, accessed with [Kysely](https://kysely.dev/) (typed SQL query builder)
  and evolved through a tracked, ordered migration system
* Language: TypeScript
* Deployment: Docker (multi-stage) + nginx

## Requirements

* Docker Desktop or Docker Engine

## Running the project

The project ships two stacks: a **development** stack with hot reload, and a **production**
stack that serves an optimized build behind nginx.

Both read configuration from a single `.env` file at the repository root.

### First-time setup

1. Install [Docker Desktop](https://docs.docker.com/desktop/) and make sure it is running.
2. Clone the repository.
3. Copy `.env.example` to `.env`, then open it and set `POSTGRES_PASSWORD` to a password of
   your choice. (`.env` is gitignored and never baked into an image.)

### Development

Hot reload for both the frontend (Vite HMR) and the backend (`tsx watch`). Source is
bind-mounted, so edits on your machine apply immediately inside the containers.

```bash
docker compose up --build
```

Open **http://localhost:5173**.

```bash
docker compose logs -f frontend   # follow logs for one service
docker compose down               # stop (keeps saved canvases)
docker compose down -v            # stop AND delete the database volume
```

### Production

Serves the minified, content-hashed Rollup bundle from nginx, with the backend compiled to
a single JavaScript file and run as an unprivileged user.

```bash
docker compose -f docker-compose.prod.yaml up --build -d
```

Open **http://localhost:8080** (change with `PROD_PORT` in `.env`).

```bash
docker compose -f docker-compose.prod.yaml logs -f
docker compose -f docker-compose.prod.yaml down
```

> Run one stack at a time. They use separate database volumes, so canvases drawn in
> development do not appear in production.

**What the production stack does differently:**

| | Development | Production |
|---|---|---|
| Frontend | Vite dev server, HMR, unminified | nginx serving a Rollup bundle (~69 KB gzipped) |
| Backend | `tsx watch`, types stripped unchecked | `tsc --noEmit` + esbuild bundle, run as `node` user |
| `/api` + `/ws` proxy | Vite `server.proxy` | nginx `proxy_pass` |
| Source on disk | bind-mounted | none — images are self-contained |
| Exposed ports | 5173, 3000, 5432 | **8080 only** |
| Image size | ~509 MB frontend | **~93 MB** frontend |

### Deploying to a server

The production stack is self-contained and runs anywhere Docker runs — a VPS, a
DigitalOcean droplet, an EC2 instance, or any platform that accepts a `docker-compose.yaml`.

The client connects to a **relative** `/ws` path rather than a hardcoded host, so the same
built image works on any domain with no rebuild: whatever origin serves the page also
proxies the WebSocket.

To deploy:

1. Copy the repository (or just the compose file and Dockerfiles) to the host.
2. Create `.env` there with a **strong** `POSTGRES_PASSWORD`.
3. Set `PROD_PORT=80` (or keep 8080 and put a reverse proxy in front).
4. `docker compose -f docker-compose.prod.yaml up --build -d`

For a public deployment, terminate TLS in front of the stack — for example with
[Caddy](https://caddyserver.com/) or nginx on the host, or Cloudflare. The app already
upgrades `http:`→`ws:` and `https:`→`wss:` automatically based on the page's origin, so no
code changes are needed to run behind HTTPS.

Health endpoint for load balancers and platform probes: **`GET /api/health`**.

## How to use

<img width="1280" height="720" alt="Example Image with listed terms" src="https://github.com/user-attachments/assets/290d0ae9-1e0c-4656-8ac5-d4c1dcc76b9d" />

### Terminology
The "ToolBar" contains a list of tools that you can access to interact with the application in a variety of ways. It is open by default on desktop platforms. On mobile platforms, you can open it by pressing the hamburger button in the top-left.

The "Room Selector" is where you can change rooms. Pressing it will open a popup, asking for a new room id to enter.

The "Tools" are the drawing/action buttons. Pressing one will change how you interact with the "Canvas". Hovering over them will reveal their name.

The "Canvas" displays and allows users to edit the current room’s drawing.

The "Color Picker" allows you to switch between primary/secondary colors, or change the primary/secondary colors. Click on the Brush to swap the primary and secondary. Click on the colored rectangle to open a popup to change that color.

The "Room Info" shows the current room details.

### Desktop Shortcuts
* Left-click will use the primary color, while right-click will use the secondary color.
* Middle-click and drag to pan the canvas; scroll to zoom.
* `Ctrl/Cmd + Z` to undo, `Ctrl/Cmd + Shift + Z` to redo.

More shortcuts will be added in the future.

## How it works

The application uses a client-server architecture in which **the server owns an
authoritative pixel buffer** for every room — not a list of shapes.

When a user joins a room, the backend loads that room's canvas from its in-memory cache or
from PostgreSQL and sends it as a one-time snapshot. Drawing gestures are converted into
small instructions (`pencil`, `eraser`, `bucket`) and broadcast to everyone in the room;
each client applies the instruction locally so all canvases stay in sync. Room state is
saved to the database periodically and whenever the last client leaves.

Two details are worth calling out:

**Shared drawing code.** The `shared/` folder holds the pixel algorithms — Bresenham line
drawing, flood fill, patch application — and is imported and executed by *both* the browser
and the Node server. There is one implementation rather than two that must be kept in sync,
which is what lets the server maintain a canvas provably identical to what clients render.

**Cheap synchronization.** Rather than periodically broadcasting the whole canvas, the
server sends a tiny `revision_check` heartbeat. Clients compare it against their own last
applied revision, and only a client that has actually fallen behind requests a fresh
snapshot — so the common case costs a few dozen bytes instead of the full canvas, and that
cost does not grow with canvas size.

**Concurrency-safe undo.** Undo/redo is expressed as compare-and-swap patches: each entry
records the pixel's previous and next color, and only applies if the pixel still holds the
expected previous color. If a collaborator has painted over that area in the meantime, the
affected entries are skipped rather than clobbering their work, and the user is told the
undo applied only partially.

**Durable by event sourcing.** The database does not just store the latest picture. Every
applied instruction is appended to a `draw_events` log, and full-canvas **snapshots** are
written periodically as checkpoints. Recovery after a crash is "load the latest snapshot,
then replay every event newer than it" — so a hard `docker kill` loses at most the events
buffered in the last ~250 ms, not the 15 s between snapshots. When a snapshot is written it
also **compacts** the log (deletes the events it now supersedes), keeping storage bounded.
On a clean shutdown (`SIGTERM`) the server flushes every room before exiting, so a normal
deploy loses nothing at all. The schema is created and evolved by ordered SQL migrations
that run automatically on startup.

**Identity, presence and cursors.** Every connection is given an identity when the
WebSocket opens: a logged-in user (recognised from their session cookie, sent on the
upgrade request) draws under their account name and colour; everyone else is an anonymous
guest with a generated name and colour. The server broadcasts the room's roster on every
join and leave, and relays each client's cursor position to the others — ephemerally, never
touching the canvas or the event log. Logging in or out reconnects the socket so the server
re-resolves who you are without a page reload.

**Accounts.** Registration hashes the password with scrypt (salted, memory-hard) and never
stores the password itself. A login creates a server-side session whose token lives in an
httpOnly, SameSite cookie — the database stores only a hash of that token, so a database
leak can't be replayed as live logins. The saved colour palette is per-account (the
`/api/colors` endpoints); guests keep theirs in the browser.

**Security hardening.** The auth surface defends against the usual web attacks: login and
register are rate-limited per IP; the WebSocket upgrade and state-changing API requests are
checked against an `ALLOWED_ORIGINS` allowlist (blocking cross-site WebSocket hijacking and
CSRF on top of the SameSite cookie); passwords are checked against a common-password
blocklist; presence broadcasts carry no account identifier; and nginx serves a
Content-Security-Policy plus HSTS, `X-Frame-Options`, and `nosniff`. Known remaining work —
email verification, a breached-password (HIBP) check, and a Redis-backed store so rate
limiting and sessions work across multiple backend instances — is noted in `CLAUDE.md`.

## Project structure

This is a monorepo full-stack application. All server-side and client-side code is shared here.

```
├── frontend/     React + Vite SPA, nginx config for production
├── backend/      Express + ws server; owns the DB schema (migrations) and all access
├── shared/       Drawing protocol + algorithms, imported by BOTH sides
├── database/     Stock PostgreSQL image (schema lives in backend/src/db/migrations)
└── loadtest/     Standalone WebSocket load-testing harness
```

`CLAUDE.md` at the repository root holds detailed architecture notes.

## Tests

Two layers, matched to what each is best at.

**Unit tests** cover the `shared/` drawing protocol with [Vitest](https://vitest.dev/). It is
the highest-value code in the repo to test: pure, dependency-free and deterministic (no DOM,
no network, no database), and **both** the browser and the server execute it — so a bug
there desynchronises every client from the server's authoritative canvas.

```bash
npm ci             # once, at the repo root
npm test           # shared protocol unit tests
npm run test:watch
npm run test:coverage
```

They live next to the code they cover, in `shared/utils/__tests__/`, covering Bresenham
line drawing, flood fill, the compare-and-swap patch logic behind undo, and rejection of
malformed input from the network. The frontend also unit-tests its pure colour-space maths
(`cd frontend && npm test`), and password hashing is unit-tested on the backend.

**Integration tests** cover the database repository and auth layers against a real
PostgreSQL — migrations, upserts, event append/replay, compaction, `ON DELETE CASCADE`,
user/session lifecycle, and the saved-colour palette. These can only be verified against a
real database, so they are gated on one being reachable and skip otherwise.

```bash
cd backend && npm ci
# point at any Postgres (e.g. a throwaway container) and run:
POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_USER=postgre \
POSTGRES_PASSWORD=... POSTGRES_DB=info_db npm test
```

CI runs both layers on every pull request, then builds the production images and drives the
whole stack end-to-end over HTTP and WebSocket (`.github/workflows/ci.yml`).

## Development reference

Docker is the supported way to run the app, but these scripts are useful when working on
the code directly.

```bash
# Root — tests for the shared protocol
npm ci
npm test
npm run typecheck:shared

# Frontend
cd frontend
npm ci
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build  -> dist/
npm run preview    # serve dist/ locally to check the real bundle
npm run lint

# Backend
cd backend
npm ci
npm run dev        # tsx watch
npm run typecheck  # tsc --noEmit
npm run build      # esbuild bundle -> dist/server.js
npm start          # node dist/server.js
npm test           # repository integration tests (needs a reachable Postgres)

# Load testing (see loadtest/README.md)
cd loadtest
npm ci
npm run run -- --clients 50 --room demo --durationMs 30000
npm run ramp -- --room demo --levels 5,10,25,50,100,200
```

> **Note:** Vite and `tsx` strip TypeScript types *without checking them*. Only
> `npm run build` (frontend) and `npm run typecheck` (backend) actually verify types, and
> both now run inside the production image build — so a type error fails the build instead
> of shipping.

## Future improvements

* Horizontal scaling — room state is currently an in-process `Map`; broadcasting across
  instances would need a shared bus (e.g. Redis pub/sub)
* Email verification and password reset
* Stroke size controls
* Export/import canvas
* Prompt for a room ID before loading the canvas (i.e. removing the default 'TestRoom')
