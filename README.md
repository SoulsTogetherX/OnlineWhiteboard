<p align="center">
  <a href="./LICENSE"> 
	<img alt="Static Badge" src="https://img.shields.io/badge/license-Apache%202.0-green">
  </a>
</p>

# Online Whiteboard

A real-time collaborative whiteboard. People join a **room** by name and draw together on a
shared canvas — every stroke appears on everyone's screen live, with their cursors moving in
real time. It works across devices (open the same room on a laptop and a phone), keeps a
durable per-room canvas that survives server restarts, and offers optional accounts with
room ownership, a saved colour palette, and a scrubbable history of how each canvas was
drawn.

<img width="1920" height="882" alt="The whiteboard in use" src="https://github.com/user-attachments/assets/764d1d05-62f6-45a1-9438-43840e77acf6" />

> The screenshots in this README predate the current UI (lobby, grouped sidebar, dark mode)
> and are worth recapturing.

## Features

**Drawing**

* Real-time shared drawing across everyone in the same room, with live cursors that show
  each person's current tool
* A full tool set: **grab** (pan/zoom), **pencil**, **eraser**, **fill** (flood fill),
  **spray**, **blur**, and an **eyedropper** that samples a colour off the canvas
* Adjustable brush **size**, spray **density**, and pointer **stabilization** (smoothing) —
  a live dotted outline previews exactly which pixels a tool will change
* A full **colour picker** — hue/saturation/value, recent colours, a saved palette, and
  primary/secondary colours you can swap
* **Undo / redo that is safe under concurrent editing** — undoing never clobbers a
  collaborator's later work
* **Export** the canvas as PNG, WebP, JPEG, or Bitmap
* Per-room **canvas resize**, light/**dark mode**, and a desktop + mobile layout

**Rooms, accounts & history**

* **Live presence** — see who else is in the room
* **Accounts (optional)** — draw as a guest, or sign in for a persistent identity and a
  saved palette that follows you across devices. Registration screens passwords against
  known breaches, and email addresses are encrypted at rest
* **Ownership & roles** — claim an unowned room to become its owner; owners control who may
  draw (open editing on/off), resize or clear the canvas, and promote members. Editors draw
  and manage history; viewers are read-only
* **Timeline** — save named **checkpoints**, restore the canvas to one, and **scrub** the
  whole drawing back to front like a recording
* **Durable canvases** — survive server restarts and hard crashes with sub-second data loss

## Tech stack

* **Frontend:** React + Vite (TypeScript), served in production as a static bundle by nginx
* **Backend:** Node.js + Express + WebSockets (`ws`), compiled to a single bundle with esbuild
* **Shared:** the drawing protocol and pixel algorithms live in `shared/` and run on **both**
  sides — one implementation, so the server and every client stay pixel-identical
* **Database:** PostgreSQL via [Kysely](https://kysely.dev/) (typed SQL), with ordered
  migrations that run automatically on startup
* **Auth:** email + password (scrypt), httpOnly cookie sessions stored server-side as
  hashes, a breached-password (HIBP k-anonymity) check, and email-at-rest encryption
* **Deployment:** Docker (multi-stage) + nginx; one health endpoint at `GET /api/health`

A deep, file-by-file explanation of *how and why* every part works — the crypto and what it
defends against, the convergence model, the event-sourced recovery, the compression, the
permission model — lives in **`CLAUDE.md`** at the repository root.

---

## Running it locally

You need **Docker** (Desktop or Engine). Everything runs in containers; you do not need
Node installed to run the app.

### First-time setup

1. Clone the repository.
2. Copy `.env.example` to `.env`.
3. Set `POSTGRES_PASSWORD` to any value. That is all you need for local development — the
   email-at-rest secrets fall back to insecure dev defaults with a warning (see
   [deployment](#deploying-online) for what production requires instead).

### Development (hot reload)

Frontend (Vite HMR) and backend (`tsx watch`) both reload on save; your source is
bind-mounted into the containers.

```bash
docker compose up --build
```

Open **http://localhost:5173**, type a room name, and start drawing. Open the same URL and
room in another tab, browser, or device on your network to collaborate.

```bash
docker compose logs -f frontend   # follow one service's logs
docker compose down               # stop (keeps saved canvases)
docker compose down -v            # stop AND delete the database volume
```

### Production build (locally)

Serves the minified, content-hashed bundle from nginx with the backend compiled and run as
an unprivileged user — the same images you would deploy.

```bash
docker compose -f docker-compose.prod.yaml up --build -d
```

Open **http://localhost:8080** (change with `PROD_PORT` in `.env`).

> Run one stack at a time. They use **separate** database volumes, so canvases drawn in
> development do not appear in production.

| | Development | Production |
|---|---|---|
| Frontend | Vite dev server, HMR | nginx serving a Rollup bundle |
| Backend | `tsx watch`, types stripped unchecked | typechecked, esbuild bundle, run as `node` user |
| `/api` + `/ws` proxy | Vite `server.proxy` | nginx `proxy_pass` |
| Source on disk | bind-mounted | none — images are self-contained |
| Exposed host ports | 5173, 3000, 5432 | **nginx only** (8080) |
| Image size | ~500 MB frontend | ~50 MB frontend (nginx + static assets) |

---

## Deploying online

The production stack runs anywhere Docker runs — a VPS, a droplet, an EC2 instance, or any
platform that accepts a Compose file. Because the client connects to a **relative** `/ws`
path (never a hardcoded host), the exact same image works on any domain with no rebuild:
whatever origin serves the page also proxies the socket.

### 1. Set real secrets in `.env`

Production **will not start** with placeholder email secrets, and its session cookie is
`Secure` (see step 3). Generate strong values:

```bash
# a strong database password (any long random string)
openssl rand -base64 24

# the two email-at-rest secrets — each a 32-byte base64 key, and deliberately different
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # EMAIL_INDEX_PEPPER
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # EMAIL_ENCRYPTION_KEY
```

Set `POSTGRES_PASSWORD`, `EMAIL_INDEX_PEPPER`, and `EMAIL_ENCRYPTION_KEY` in `.env`. Keep
`.env` off version control (it already is).

### 2. Lock the origin allowlist to your domain

`ALLOWED_ORIGINS` is the CSRF / cross-site-WebSocket-hijacking allowlist. Set it to your
real site origin(s), comma-separated — e.g. `ALLOWED_ORIGINS=https://draw.example.com`. A
request whose `Origin` is not listed is rejected. (Left empty it fails *open* with a startup
warning, which is fine for a private test box and wrong for a public one.)

### 3. Put HTTPS in front — this is required, not optional

The stack publishes plain HTTP on `PROD_PORT` (default 8080) and is designed to sit **behind
a TLS-terminating reverse proxy**. Two reasons it must:

* The session cookie is `Secure` in production, so browsers only send it back over HTTPS. On
  a real domain served over plain `http://`, logins silently fail to persist. (This is
  correct hardening, not a bug — the fix is TLS, not disabling the flag.)
* You want encrypted traffic for a public app regardless.

The app already upgrades `https:` → `wss:` from the page's own origin, so **no code or config
change is needed** to run behind HTTPS. The simplest turnkey option is
[Caddy](https://caddyserver.com/), which obtains and renews Let's Encrypt certificates
automatically and proxies WebSockets transparently:

```caddyfile
# /etc/caddy/Caddyfile on the host — point your domain's DNS at this server first
draw.example.com {
    reverse_proxy localhost:8080
}
```

```bash
# start the app, then Caddy in front of it
docker compose -f docker-compose.prod.yaml up --build -d
caddy run --config /etc/caddy/Caddyfile
```

nginx-on-the-host, a cloud load balancer, or Cloudflare work equally well — anything that
terminates TLS and forwards to `localhost:8080` with WebSocket upgrades passed through.

### 4. Operate it

* **Health check** for load balancers / platform probes: `GET /api/health` (returns `200`
  without touching the database, so a DB blip doesn't fail the liveness probe).
* **Multiple devices / users:** there is nothing per-device to configure — anyone who can
  reach the domain and enters the same room name is collaborating. Guests can draw
  immediately; accounts are only needed for ownership, a saved palette, or a cross-device
  identity.
* **Backups:** all durable state (canvases, history, accounts) is in the Postgres volume
  (`whiteboard-database-prod-v`). Back that up.
* **Graceful deploys:** the backend flushes every room to Postgres on `SIGTERM`, so a normal
  `docker compose ... down` / redeploy loses nothing. A *hard* kill loses at most the last
  ~250 ms of drawing.

> **Scale limit — read before you grow.** Room state, presence, rate limiting and sessions
> all live in the backend process's memory, so the app runs as a **single backend instance**.
> Vertical scaling (a bigger box) is fine; running two backend replicas would split rooms
> across them. Multi-instance would need a shared bus (Redis pub/sub) for broadcasts and a
> shared store for limits — noted in `CLAUDE.md §14`.

---

## Using the app

You open onto a **lobby**: sign in or register (optional), enter a **room name**, and you are
in. Everything else lives in the right-hand **sidebar**, which has three tabs:

* **Drawing** — the tool picker, colour controls, undo/redo, and the size/density/
  stabilization sliders for the active tool.
* **Room** — foldable sections for this room: **Permissions & canvas** (ownership, open
  editing, resize), **Cursors** (show/hide others' cursors and names), **Checkpoints** (save,
  restore, replay the timeline), and **Rooms** (change room, browse *My Rooms*, leave). Clear
  and download are pinned to the bottom.
* **Account** — sign in/out, change your display name, or delete your account.

The light/dark toggle sits top-left; the *My Rooms* dashboard and members list (when signed
in) sit top-right.

### Shortcuts & pointer

* **Draw** with the left button (primary colour) or right button (secondary colour).
* **Pan / zoom the canvas** by holding **Shift** — Shift+drag pans, Shift+wheel zooms — or by
  selecting the **Grab** tool (the default on load), which makes pan/zoom the plain drag/wheel
  without holding anything. While Shift is held a move-arrows cue appears top-left, because
  the mode is otherwise invisible.
* **Bare mouse wheel** (over the canvas, no Shift) adjusts the tool's **last-used slider** —
  size the brush, try it, resize it, without going back to the sidebar. Press **`D`** to
  switch which slider the wheel drives.
* **Tool keys** (while the sidebar is open): **G** grab · **P** pencil · **E** eraser ·
  **F** fill · **S** spray · **B** blur · **I** eyedropper.
* **`Ctrl/Cmd + Z`** undo · **`Ctrl/Cmd + Shift + Z`** redo.

---

## How it works

The core idea: **the server owns an authoritative pixel buffer for every room** — not a list
of shapes. Clients draw optimistically for instant feedback and reconcile to the server's
truth continuously.

* **One drawing implementation, run on both sides.** `shared/` holds the pixel algorithms
  (Bresenham lines, flood fill, spray scatter, blur, compare-and-swap patches) and the wire
  protocol, imported by *both* the browser and the Node server. There is no second copy to
  drift, which is what lets the server keep a canvas provably identical to what clients render.
* **Instructions, not pixels, on the wire.** A gesture becomes a small instruction
  (`pencil`, `spray`, `bucket`, …) that the server applies, logs, and broadcasts; every client
  replays it. A spray sends a *seed*, not a pixel list, and everyone scatters identically — so
  the message stays tiny no matter how much it paints.
* **Cheap synchronization.** Instead of re-broadcasting the canvas, the server sends a small
  revision heartbeat; only a client that has actually fallen behind requests a fresh snapshot.
  The common case costs a few dozen bytes and does not grow with canvas size.
* **Concurrency-safe undo.** Undo is a compare-and-swap patch: each entry only applies if the
  pixel still holds the colour it expects, so undoing over a collaborator's later work skips
  those pixels rather than clobbering them (and tells you it applied partially).
* **Instant-feel input.** A pixel you just painted is held on screen for ~100 ms even if a
  collaborator overwrites it at the same instant — a display-only overlay that never changes
  what actually converges, so your input never *feels* eaten while the final canvas stays
  identical for everyone.
* **Durable by event sourcing.** Every applied instruction is appended to a `draw_events`
  log; snapshots are written periodically. Recovery is "load the latest snapshot, replay every
  newer event," so a hard crash loses ~250 ms, not the 15 s between snapshots. The log is
  compacted and uniformly **decimated** so storage stays bounded while the whole timeline
  remains scrubbable, and a resize is a clean history boundary.
* **Identity, ownership & security.** Connections get an identity at the WebSocket upgrade
  (a signed-in user from the session cookie, or a generated guest). Permission checks use the
  same shared rules on both sides, but the server's are authoritative. The auth surface is
  hardened per OWASP/NIST: scrypt password hashing, hashed session tokens, a breached-password
  check, AES-GCM email-at-rest with a slow blind index, per-IP rate limits, a per-socket
  token-bucket flood limiter, origin allow-listing, and a strict Content-Security-Policy.

Every one of these has a full write-up — including the threat model and the exact bugs each
guard exists to prevent — in `CLAUDE.md`.

## Project structure

```
├── frontend/     React + Vite SPA; nginx config for production
├── backend/      Express + ws server; owns the DB schema (migrations) and all DB access
├── shared/       Drawing protocol + pixel algorithms, imported by BOTH sides
├── database/     PostgreSQL image (schema lives in backend/src/db/migrations)
├── scripts/      Zero-dependency end-to-end probes (smoke / security / permissions)
└── loadtest/     Standalone WebSocket load-testing harness
```

## Tests

Five layers, each matched to what it is best at; `TESTING.md` is the full guide.

* **Shared protocol unit tests** (Vitest) — the highest-value code in the repo: pure,
  deterministic, and executed by both sides, so a bug there desyncs everyone. Covers line
  drawing, fill, spray, blur, the CAS patch logic, the codecs, and rejection of malformed
  network input.
* **Frontend unit tests** — the pure colour-space and slider-tracking logic.
* **Backend integration tests** — the repository and auth layers against a **real** Postgres
  (migrations, event append/replay, compaction, `ON DELETE CASCADE`, session lifecycle).
* **End-to-end probes** (`scripts/*.mjs`) — drive the *running production stack* over HTTP and
  WebSocket: a **smoke** test (the happy path through nginx and the real bundle), a
  **security** probe (adversarial — the server survives each abuse), and a **permissions**
  probe (the ownership/role model with real accounts).
* **Load test** (`loadtest/`) — many concurrent sockets against a live server.

```bash
npm ci && npm test                 # shared protocol (from the repo root)
cd frontend && npm ci && npm test  # frontend unit tests
node scripts/smoke-test.mjs http://localhost:8080   # against a running prod stack
```

CI runs the unit/integration layers on every pull request, then builds the production images
and runs all three e2e probes against the real stack (`.github/workflows/ci.yml`).

## Development reference

Docker is the supported way to run the app; these scripts are useful when working on the
code directly.

```bash
# Root — shared protocol
npm ci && npm test && npm run typecheck:shared

# Frontend
cd frontend && npm ci
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build  (tsc is the ONLY typecheck)
npm run lint

# Backend
cd backend && npm ci
npm run dev        # tsx watch
npm run typecheck  # tsc --noEmit
npm run build      # esbuild bundle -> dist/server.js
npm test           # integration tests (needs a reachable Postgres)
```

> Vite and `tsx` strip TypeScript types **without checking them**. Only `npm run build`
> (frontend) and `npm run typecheck` (backend) verify types, and both run inside the
> production image build — so a type error fails the build instead of shipping.

## Known limitations & future work

* **Single backend instance** — see the scale note above; horizontal scaling needs Redis.
* **Email verification and password reset** are not implemented (the breached-password check
  *is*).
* Rooms are entered by name with no access control beyond ownership — anyone with a room name
  can join it.

## License

[Apache 2.0](./LICENSE).
