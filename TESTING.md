# Testing & CI — a working guide

This explains what is tested, why it is tested *there* and not somewhere else, how to run
any of it, and how to add your own. It assumes no prior familiarity with the setup.

If you only read one section, read [§2 The five layers](#2-the-five-layers) and
[§6 Adding a test](#6-adding-a-test-worked-examples).

---

## 1. The idea behind the setup

Two rules shape everything below.

**A test belongs at the cheapest layer that can actually catch the bug.** A pure function
gets a pure test that runs in milliseconds. A rule enforced by the database gets a test
against a real database, because that is the only thing that can prove it. A guard that
depends on three components agreeing gets an end-to-end probe, because each component's own
tests can pass while the wiring between them is wrong.

**Typechecking is not verification.** TypeScript proves shapes line up. It cannot tell you
the undo patch was silently dropped by the rate limiter, or that the canvas came out black.
Nearly every real bug in this project's history typechecked perfectly. So the layers below
exist to answer "does it *do* the thing", and the pre-commit gate runs them rather than
trusting `tsc` alone.

There is one more constraint peculiar to this repo, and it explains the shape of the CI file:

> `shared/` has **no build boundary**. It is joined to `frontend/`, `backend/` and
> `loadtest/` by path aliases only — Vite `resolve.alias`, `tsconfig` paths, esbuild — not
> as an npm package. So a change under `shared/` must re-verify **every consumer**, not just
> the package you happened to be editing.

---

## 2. The five layers

| # | Layer | Lives in | Environment | Needs | Runs in |
|---|-------|----------|-------------|-------|---------|
| 1 | Shared protocol | `shared/**/__tests__/*.test.ts` | node | nothing | gate + CI |
| 2 | Frontend logic | `frontend/src/**/*.test.ts` | node | nothing | gate + CI |
| 3 | Frontend components | `frontend/src/**/*.test.tsx` | jsdom | nothing | gate + CI |
| 4 | Backend integration | `backend/src/**/__tests__/*.test.ts` | node | **Postgres** | CI only |
| 5 | End-to-end probes | `scripts/*.mjs` | node | **whole stack** | CI only |

### Layer 1 — Shared protocol (the highest-value tests here)

`shared/` is pure, dependency-free and deterministic: no DOM, no network, no database, just
functions over typed arrays. **Both the browser and the server execute this exact code**, so
a bug here desynchronises every client from the server's authoritative canvas — the worst
class of bug this app can have, and the hardest to spot by eye.

That combination — highest stakes, cheapest to test — is why the protocol has by far the
densest coverage. Note `vitest.config.ts` deliberately configures **no path aliases**:
`shared/` imports itself relatively, so its tests do too. The `@shared` alias is a
convenience for the other packages, not something `shared/` needs internally.

The crown jewel is `shared/utils/__tests__/convergence.test.ts`, which simulates a server and
several clients and asserts every canvas ends **byte-identical**. If you change anything in
the draw path, that is the test that tells you whether you broke the whole premise of the app.

### Layer 2 — Frontend logic

Pure client-side maths: colour conversion, the 100 ms local-hold window, undo re-anchoring
across a resize, playback marker positions. DOM-free, so it runs in the fast `node`
environment with no jsdom cost.

### Layer 3 — Frontend components

React Testing Library rendered into jsdom. These assert **behaviour through the accessible
interface** — `getByRole("button", { name: "Undo" })`, not a CSS class — which means they
survive restyling and simultaneously check the component is reachable by a screen reader.

The split between layers 2 and 3 is **by file extension, not folder**: `*.test.ts` gets the
node environment, `*.test.tsx` gets jsdom. Name the file correctly and it lands in the right
environment automatically (see `frontend/vitest.config.ts`, which defines the two as separate
vitest *projects*).

### Layer 4 — Backend integration

These talk to a **real Postgres**. That is the point: migrations, `ON CONFLICT` upserts,
`ON DELETE CASCADE`, the partial unique index that enforces one-owner-per-room, and the
snapshot/event pruning transaction cannot be verified against a mock — a mock would just
re-state what you already believe.

They are **gated on a reachable database**:

```ts
const DB_CONFIGURED = Boolean(process.env.POSTGRES_PASSWORD)
describe.skipIf(!DB_CONFIGURED)("canvasRepository", () => { ... })
```

so `npm test` stays green on a machine with no database, and the suite only actually runs
where one is provided. They also run **serially** (`fileParallelism: false`) because they
share one database.

> ⚠️ **They are skipped by default, including in the pre-commit gate.** A green local run
> does *not* mean these passed — it usually means they never ran. Run them explicitly
> (§4) before touching the repository layer.

### Layer 5 — End-to-end probes

Plain `.mjs` scripts with **zero dependencies** — Node 22's global `fetch` and global
`WebSocket` are all they use. They drive the *running production stack* over HTTP and
WebSocket:

- **`smoke-test.mjs`** — the happy path: the SPA is served, two clients join one room, a
  stroke reaches everyone, a binary patch round-trips, both canvases end byte-identical,
  playback spans the session.
- **`security-probe.mjs`** — the adversarial counterpart: unknown message types are
  rejected, an oversized frame closes the offending socket and never reaches anyone else,
  and the server is still healthy afterwards.
- **`permissions-probe.mjs`** — the whole permission model with real accounts: nobody is
  auto-owner, ownership is claimed, locking stops viewers and guests, an editor request
  round-trips, a released room can be re-claimed.

**Why these exist at all:** unit tests can agree with each other and still be wrong together.
A permission rule can be correct in `identity.ts`, correct in the handler's test, and simply
never called. Only driving the assembled thing catches that.

---

## 3. Running everything locally

From the repo root:

```bash
npm test                        # layer 1 — shared protocol
npm run typecheck:shared

cd frontend && npm test         # layers 2 + 3
cd frontend && npx tsc -b       # the ONLY thing that typechecks the frontend
cd frontend && npm run lint

cd backend && npm test          # layer 4 — SKIPS without a database (see §4)
cd backend && npm run typecheck
```

Useful vitest flags (they work in any package):

```bash
npx vitest                                   # watch mode
npx vitest run path/to/file.test.ts          # one file
npx vitest run -t "undo"                     # tests whose name matches
npm run test:coverage                        # root only, v8 coverage
```

> **Always `tsc --noEmit` or `tsc -b`, never a bare `tsc`.** A bare `tsc` **emits** `.js`
> next to your `.ts` sources, and vitest then resolves the stale JavaScript in preference to
> the TypeScript. The symptom is `Cannot find module '@shared/...'` from a file you never
> wrote, in tests that passed a minute ago. Clean up with
> `find <pkg>/src -name '*.js' -delete` — but scope it, because
> `backend/src/types/ClientSocket.d.ts` is a real tracked source file.

---

## 4. Running the layers that need infrastructure

### Backend integration tests

They need a Postgres they are allowed to write to. **Do not point them at a database you
care about** — they create and drop rows freely.

```bash
docker run --rm -d -p 55432:5432 \
  -e POSTGRES_USER=postgre -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=info_db \
  --name wb-test-db postgres:18-alpine

cd backend
POSTGRES_HOST=localhost POSTGRES_PORT=55432 \
POSTGRES_USER=postgre POSTGRES_PASSWORD=throwaway POSTGRES_DB=info_db \
npm test

docker rm -f wb-test-db
```

Port **55432**, not 5432, on purpose: a native Windows Postgres install listens on 5432 and
**shadows** the Docker one for host connections, so you end up testing against a completely
different database and the failures make no sense.

Setting `POSTGRES_PASSWORD` is what un-skips the suite. If you see every backend test
reported as skipped, that variable is missing.

### End-to-end probes

They need the **production** stack — nginx serving the built SPA plus the compiled backend,
not the dev server:

```bash
docker compose -f docker-compose.prod.yaml up --build -d --wait
node scripts/smoke-test.mjs        http://127.0.0.1:8080
node scripts/security-probe.mjs    http://127.0.0.1:8080
node scripts/permissions-probe.mjs http://127.0.0.1:8080
docker compose -f docker-compose.prod.yaml down -v
```

Pass `http://127.0.0.1:8080` explicitly rather than relying on the `localhost` default: on
some machines `localhost` resolves to IPv6 `::1` while the published port binds IPv4, and the
probe then hangs at connect with no error.

`down -v` drops the volume. Leave it out and the next run starts with the previous run's
rooms still in the database.

### Ad-hoc socket probes — the fastest tool you have

For anything protocol-level, a throwaway script beats both a unit test and a browser. Open
two sockets against the **dev** backend (published on 3000 for exactly this reason), have one
send and assert what the other receives:

```js
const ws = new WebSocket("ws://localhost:3000/ws?roomId=scratch-1")
```

The cursor-tool feature was verified this way in seconds — tool relayed, change propagated,
unknown tool rejected and never relayed, tool-less cursor still working. Keep these in a
scratch directory unless they earn a place in `scripts/`.

---

## 5. The two automated gates

### 5.1 The pre-commit gate (local, every commit)

`.githooks/pre-commit`, enabled once per clone with:

```bash
git config core.hooksPath .githooks
```

It inspects **which paths are staged** and runs only the relevant packages — with the
`shared/` rule from §1 encoded directly:

```sh
if changed "frontend/"; then RUN_FRONTEND=1; fi
if changed "backend/";  then RUN_BACKEND=1;  fi
# shared/ has no build boundary -> re-verify every consumer.
if changed "shared/"; then RUN_FRONTEND=1; RUN_BACKEND=1; fi
```

Then: shared tests + typecheck always; backend typecheck if selected; frontend typecheck +
lint + unit tests if selected. It deliberately does **not** run the backend integration tests
— a hook that needs a database is a hook people disable.

`git commit --no-verify` skips it. That is for a throwaway WIP commit on a scratch branch,
never for anything you intend to merge.

### 5.2 CI (GitHub Actions, `.github/workflows/ci.yml`)

Triggers on pushes to `main`/`dev` and on PRs into them. The PR trigger is the important
half: it is what gates merges. A new push to the same branch cancels the in-flight run
(`concurrency`), and permissions are read-only.

**Job 1 — `verify`** (~1 minute, no Docker). Fails fast on anything cheap:

1. `npm ci` — never `npm install`. `ci` installs exactly what the lockfile pins and fails if
   the lockfile has drifted from `package.json`; `install` would happily resolve something
   newer and test a different tree than you committed.
2. shared: test, typecheck
3. frontend: `npx tsc -b`, lint, test
4. backend: typecheck, then **integration tests against a Postgres service container**
5. loadtest: typecheck — it imports the same `shared/` types, so this is what catches the
   harness silently drifting off the protocol

The `services: postgres` block is how a GitHub job gets a real database: the runner starts
the container, maps 5432, and the `pg_isready` health check gates the steps until it is
actually accepting connections. The `env:` on the test step supplies the credentials — and
`POSTGRES_PASSWORD` being set is exactly what un-skips layer 4.

**Job 2 — `e2e`** (`needs: verify`, so it never burns minutes building images when the types
are already broken):

1. Write a CI `.env` from `.env.example`, generating **real** throwaway email-crypto keys.
   (The placeholders in `.env.example` are non-empty, so the server boots — but they are not
   valid 32-byte base64, so the first `register` would 500. Generated with `node`, not `sed`,
   because base64 contains `+ / =` that `sed` treats specially.)
2. `docker compose -f docker-compose.prod.yaml up --build --wait` — `--wait` blocks on the
   healthchecks, which removes the "sleep 30 and hope" flakiness this kind of job usually has
3. smoke test → security probe → permissions probe
4. On failure only, dump container logs; always tear down with `-v`

---

## 6. Adding a test — worked examples

### A pure function in `shared/`

Put it in `shared/<area>/__tests__/<name>.test.ts`. Import relatively. Use the fixtures in
`shared/utils/__tests__/testHelpers.ts` (`makeCanvas`, `DIMS`, `RED`, `paintedCount`, …)
rather than rebuilding a canvas by hand.

```ts
import { describe, expect, it } from "vitest"
import { myFunction } from "../myFunction"
import { DIMS, makeCanvas, RED } from "./testHelpers"

describe("myFunction", () => {
  it("states the behaviour, not the implementation", () => {
    const pixels = makeCanvas()
    expect(myFunction(pixels, DIMS)).toEqual(RED)
  })
})
```

### A React component

`frontend/src/components/Thing/index.test.tsx` — note the **`.tsx`**, which is what puts it
in jsdom. Follow the `renderX(overrides)` helper pattern used throughout: it gives every test
a valid set of props and lets each one override just what it cares about, so adding a prop
later means editing one line instead of twenty.

```tsx
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import Thing from "./index"

function renderThing(overrides = {}) {
  const props = { label: "Save", onSave: vi.fn(), ...overrides }
  return { props, ...render(<Thing {...props} />) }
}

describe("Thing", () => {
  it("reports a save", () => {
    const { props } = renderThing()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(props.onSave).toHaveBeenCalled()
  })
})
```

Two traps, both of which have bitten this repo:

- **Use `fireEvent` / `userEvent`, not `element.click()`.** A raw `.click()` runs outside
  React's `act()`, so state updates never flush and the assertion sees the old DOM.
- **Query by role and accessible name.** `getByRole("button", { name: "Undo" })` breaks
  loudly if the button stops being reachable; `querySelector(".undo-btn")` does not.

### A database rule

`backend/src/db/__tests__/<name>.test.ts`, and it **must** carry the gate or it will fail on
every machine without a database:

```ts
const DB_CONFIGURED = Boolean(process.env.POSTGRES_PASSWORD)
describe.skipIf(!DB_CONFIGURED)("myRepository", () => { ... })
```

Isolate by unique id (`room-${crypto.randomUUID()}`) rather than by truncating tables, so the
suite stays safe to run against a shared throwaway database.

### An end-to-end assertion

Add it to the relevant existing probe rather than writing a fourth script — they already
handle connecting, waiting and reporting. The helpers are `waitFor(seen, predicate, label)`,
`pass(msg)` and `fail(msg)`.

One rule learned the hard way: **make each probe action distinct.** `permissions-probe.mjs`
drew the identical line for every role check, and when no-op instructions stopped being
broadcast, every stroke after the first became a no-op and the probe hung waiting for an echo
that would never come. Vary position or colour per action.

---

## 7. Adding a whole new test *layer*

If you need something the five layers do not cover, the pattern is:

1. **New vitest project** — add an entry to the `projects` array in the relevant
   `vitest.config.ts` with its own `name`, `include` glob and `environment`. This is how the
   frontend's node/jsdom split works, and it keeps one `npm test` running everything.
2. **New standalone harness** (like the probes) — a dependency-free `.mjs` in `scripts/`, run
   as a CI step. Exit non-zero on failure; that is the entire contract.
3. **Wire it into both gates.** A test that only exists locally rots — the frontend's own
   unit tests sat un-run in CI for a while, so nothing would have caught them breaking. Add
   it to `.github/workflows/ci.yml`, and to `.githooks/pre-commit` if it is fast and needs no
   services.

---

## 8. When something fails

| Symptom | Almost always means |
|---|---|
| Every backend test "skipped" | `POSTGRES_PASSWORD` not set — layer 4 never ran (§4) |
| `Cannot find module '@shared/...'` from a `.js` file | A bare `tsc` emitted JavaScript next to your sources (§3) |
| Every suite fails at once | Suspect the harness, not the code — a config or emitted-JS problem |
| A probe hangs at connect | `localhost` → IPv6 vs an IPv4-bound port; pass `127.0.0.1` (§4) |
| `register -> 429` in a probe | The register rate limit (5/hour/IP) from repeated runs. Restart the backend container — the limiter is in-memory |
| Probe passes locally, fails in CI | CI starts from an empty database every run; you are probably depending on state a previous local run left behind |
| A component test can't find a control | Query by role/name; if it genuinely is not reachable that way, the accessibility bug is the real finding |

**The rule when a whole suite goes red at once:** suspect the harness before the code. A
single broken behaviour breaks a handful of tests; a broken config breaks all of them.
