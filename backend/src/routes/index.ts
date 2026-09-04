//#region Imports
import express, { Express } from "express"

import configureAuthRoutes from "./auth"
import configureColorRoutes from "./colors"
import configureRoomRoutes from "./rooms"
import { csrfOriginGuard } from "@/security/csrf"
import { httpMetrics, metricsAuth, metricsHandler } from "@/observability/metrics"
//#endregion

//#region Configure Routes
export default function configure(app: Express) {
  // First, so it times every request — including the ones the CSRF guard
  // rejects. A latency histogram that excludes refused requests would hide
  // exactly the traffic you look for during an incident.
  app.use(httpMetrics)

  // Reject state-changing requests from unrecognised origins before any body is
  // parsed or any handler runs (defence-in-depth over the SameSite cookie).
  app.use(csrfOriginGuard)

  // Registered exactly once, here. It used to be applied in both server.ts
  // (default 100kb limit) and again here (2mb limit) — but express.json marks
  // the request as parsed, so the second registration was always a no-op and
  // the 2mb limit never actually took effect.
  //
  // 64kb, not 2mb: the largest legitimate body this API takes is a register
  // form. Canvas data never travels over HTTP — it goes down the socket, which
  // has its own derived 3 MiB ceiling — so a multi-megabyte JSON limit only ever
  // sized the buffer an unauthenticated caller could make the server allocate.
  app.use(express.json({ limit: "64kb" }))

  configureAuthRoutes(app)
  configureColorRoutes(app)
  configureRoomRoutes(app)

  // Liveness probe. Both Dockerfiles' HEALTHCHECK and every deploy platform
  // (Render, Fly, Railway, Kubernetes) poll an endpoint like this to decide
  // whether a container is up and whether to route traffic to it.
  //
  // Deliberately does NOT touch Postgres. A health check that depends on the
  // database turns a brief DB blip into "kill the app", and under load the
  // probe itself competes for connections. Liveness answers "is this process
  // healthy", not "is every dependency reachable".
  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() })
  })

  // Prometheus scrape target. Unlike /api/health this is NOT public: it
  // enumerates routes, error rates and connection counts, so it sits behind
  // METRICS_TOKEN (Bearer or Basic-password) — open in development, 404 in
  // production until the token is configured. See observability/metrics.ts.
  app.get("/api/metrics", metricsAuth, metricsHandler)
}
//#endregion
