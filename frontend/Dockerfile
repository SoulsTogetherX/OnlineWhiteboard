# syntax=docker/dockerfile:1
#
# Multi-stage build for the frontend.
#
# A "stage" is just a named FROM. `docker build --target dev` stops at the dev
# stage; --target prod runs the whole chain. Stages that nothing depends on are
# skipped, and stages that don't depend on each other build in parallel. This is
# how one file serves both `docker compose up` (dev, HMR) and
# `docker compose -f docker-compose.prod.yaml up` (prod, nginx).
#
# The build context is the REPO ROOT (set in docker-compose*.yaml), not
# ./frontend — that's what lets these stages reach ../shared.

##############################################################################
# deps — install node_modules once, cached until the manifests change.
##############################################################################
FROM node:22-alpine AS deps
WORKDIR /app

# Copying ONLY the manifests before installing is the single most important
# line in this file. Docker caches each instruction as a layer and invalidates
# every later layer when an earlier one changes. The previous version did
# `COPY ./frontend .` and *then* `RUN npm install`, so editing one line of CSS
# invalidated the install layer and re-downloaded every dependency on every
# build. Source is copied after this, so now a source edit reuses the cache.
COPY frontend/package.json frontend/package-lock.json ./

# `npm ci` (not `npm install`): installs exactly what package-lock.json pins,
# fails if the lock is out of sync with package.json, and never mutates the
# lock. That's what makes a build reproducible — `npm install` is free to
# silently resolve a newer version and give you a different image tomorrow.
RUN npm ci

##############################################################################
# dev — Vite dev server with HMR. Used by docker-compose.yaml.
#
# Source is bind-mounted over /app/src at run time, so what's copied here is
# only a fallback that keeps the image runnable on its own.
##############################################################################
FROM deps AS dev
COPY shared/ /shared/
COPY frontend/ ./
EXPOSE 5173
# --host 0.0.0.0 binds all interfaces. Vite defaults to localhost, which inside
# a container means "this container only" and would be unreachable from the host.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

##############################################################################
# build — typecheck + Rollup production bundle.
##############################################################################
FROM deps AS build

# shared/ must land at /shared: WORKDIR is /app, and both vite.config.ts's
# resolve.alias and tsconfig.app.json's paths point @shared at ../shared, which
# resolves to /shared. This mirrors the compose bind mount used in dev, so the
# same alias works in both modes.
COPY shared/ /shared/
COPY frontend/ ./

# `npm run build` is `tsc -b && vite build`:
#   tsc -b     -> the ONLY thing that typechecks. Vite/esbuild strip types
#                 without checking them, which is exactly how this project
#                 accumulated type errors while appearing to run fine.
#   vite build -> Rollup: tree-shake, minify, code-split, content-hash.
# Because tsc runs first and && short-circuits, a type error now fails the
# image build instead of shipping.
RUN npm run build

##############################################################################
# prod — nginx serving the static bundle. No Node, no source, no node_modules.
#
# The runtime image contains only ~200KB of built assets on top of nginx:alpine
# (~50MB), versus ~500MB for a node image carrying the full toolchain. Smaller
# image = faster deploys, less to patch, smaller attack surface. Nothing that
# built the app is present at runtime — that's the point of multi-stage.
##############################################################################
FROM nginx:1.29-alpine AS prod

# Rendered by the nginx image's entrypoint via envsubst at container start.
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# 127.0.0.1, NOT localhost. nginx.conf.template says `listen 80`, which binds
# IPv4 only (0.0.0.0:80) — and inside the container `localhost` resolves to ::1
# first, so the probe got "connection refused" and the container was marked
# unhealthy while serving traffic perfectly. `docker compose up --wait` then
# fails on a completely healthy app.
#
# Adding `listen [::]:80` to nginx would also fix it, but nginx refuses to start
# at all on a host without IPv6 — trading a false-unhealthy for a hard boot
# failure. Naming the address explicitly avoids the resolution order entirely.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/ || exit 1
