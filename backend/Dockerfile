# syntax=docker/dockerfile:1
#
# Multi-stage build for the backend. See frontend/Dockerfile for the general
# explanation of stages and layer caching.
#
# Build context is the REPO ROOT so these stages can reach ../shared.

##############################################################################
# deps — install node_modules once, cached until the manifests change.
##############################################################################
FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

##############################################################################
# dev — tsx watch. Used by docker-compose.yaml; source arrives via bind mount.
##############################################################################
FROM deps AS dev
COPY shared/ /shared/
COPY backend/tsconfig.json ./
COPY backend/src ./src
EXPOSE 3000
CMD ["npm", "run", "dev"]

##############################################################################
# build — typecheck, then bundle with esbuild.
#
# WHY esbuild AND NOT PLAIN tsc
# -----------------------------
# This code imports "@shared/constants/canvas" and "@/db/canvasRepository".
# Those are tsconfig `paths` aliases — and `paths` is a TYPECHECK-ONLY fiction.
# tsc resolves them when checking types but emits the specifier VERBATIM:
#
#     const canvas_1 = require("@shared/constants/canvas");   // <- tsc output
#
# Plain `node` has no idea what "@shared" means, so a tsc-built server dies at
# startup with MODULE_NOT_FOUND. It works under `tsx` in dev only because tsx
# reads tsconfig and resolves the aliases at runtime.
#
# esbuild resolves `paths` at build time and inlines shared/ into the output,
# so the emitted bundle contains no aliases at all — only real package requires.
#
# Flags:
#   --bundle            follow and inline our own imports (incl. shared/)
#   --packages=external leave node_modules as require() calls. Bundling deps
#                       would inline pg, whose optional native binding uses a
#                       dynamic require that bundlers mangle.
#   --platform=node     node resolution + builtins, not browser
#   --format=cjs        matches tsconfig "module": "CommonJS"; package.json has
#                       no "type": "module"
#   --sourcemap         production stack traces point at .ts lines
##############################################################################
FROM deps AS build
COPY shared/ /shared/
COPY backend/tsconfig.json ./
COPY backend/src ./src

# esbuild strips types WITHOUT checking them (same as Vite). So typecheck
# explicitly — otherwise a type error ships silently, which is exactly the
# failure mode this whole production path exists to close.
RUN npm run typecheck && npm run build

##############################################################################
# prod — runtime only: production deps + the bundle. No TypeScript, no tsx,
# no esbuild, no source.
##############################################################################
FROM node:22-alpine AS prod
WORKDIR /app

# Signals intent to Node and to libraries (Express skips view caching /
# verbose errors when set). Must be set at RUNTIME, not just at build.
ENV NODE_ENV=production

COPY backend/package.json backend/package-lock.json ./

# --omit=dev drops typescript, tsx, esbuild and @types from the runtime image.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Run unprivileged. The node images ship a `node` user for exactly this; the
# default is root, and a root process plus a container escape is a bad pairing.
# Nothing here writes to disk, so read-only ownership is fine.
USER node

EXPOSE 3000

# Hit the health route rather than just checking the port is open — this proves
# Express is actually routing, not merely that something bound the socket.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.BACKEND_PORT||3000)+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# `node dist/server.js` directly — NOT `npm start`. npm would sit in the middle
# as PID 1 and not forward SIGTERM, so `docker stop` would hang for the full
# 10s kill timeout and Node would never see the signal. Running node as PID 1
# is what lets the graceful-shutdown handler in src/server.ts actually receive
# SIGTERM and flush every dirty room's buffered events plus a final snapshot
# before exit — so a normal deploy loses nothing.
CMD ["node", "dist/server.js"]
