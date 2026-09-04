import { EventEmitter } from "node:events"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  httpMetrics,
  metricsAuth,
  metricsHandler,
  registry,
  wsMessagesReceived,
} from "../metrics"

import type { NextFunction, Request, Response } from "express"

// Pure unit test — no database. The scrape output is text, so most assertions
// are "this series name appears with this value", which is also exactly what
// scripts/metrics-probe.mjs asserts against the running production stack.

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

//#region Fakes
// The middlewares touch a handful of express surface: headers on the request,
// status/set/end/send on the response, plus the 'finish' event httpMetrics
// listens for. An EventEmitter with those members is the whole contract.
function fakeRes() {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number
    headers: Record<string, string>
    body?: unknown
    status(code: number): typeof res
    set(field: string, value?: string): typeof res
    end(): typeof res
    send(body: unknown): typeof res
  }
  res.statusCode = 200
  res.headers = {}
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.set = (field, value) => {
    res.headers[field] = value ?? ""
    return res
  }
  res.end = () => res
  res.send = (body) => {
    res.body = body
    return res
  }
  return res
}

function fakeReq(overrides: Partial<Record<string, unknown>> = {}): Request {
  return {
    method: "GET",
    path: "/api/health",
    headers: {},
    ...overrides,
  } as unknown as Request
}

function run(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  req: Request,
): { res: ReturnType<typeof fakeRes>; nextCalled: boolean } {
  const res = fakeRes()
  let nextCalled = false
  middleware(req, res as unknown as Response, () => {
    nextCalled = true
  })
  return { res, nextCalled }
}
//#endregion

describe("registry", () => {
  it("serves the instrumented series and the Node runtime defaults", async () => {
    wsMessagesReceived.inc({ type: "ping" })

    const text = await registry.metrics()
    // Registered instruments advertise themselves in TYPE headers even before
    // an observation, which is what the CI probe keys on.
    expect(text).toContain("# TYPE ws_messages_received_total counter")
    expect(text).toContain('ws_messages_received_total{type="ping"}')
    expect(text).toContain("# TYPE ws_broadcast_duration_seconds histogram")
    expect(text).toContain("# TYPE event_flush_duration_seconds histogram")
    expect(text).toContain("# TYPE http_request_duration_seconds histogram")
    // One representative prom-client default: event-loop lag, the Node vital.
    expect(text).toContain("nodejs_eventloop_lag_seconds")
  })
})

describe("httpMetrics", () => {
  it("records latency by route template once the response finishes", async () => {
    const req = fakeReq({ route: { path: "/api/health" } })
    const { res, nextCalled } = run(httpMetrics, req)
    expect(nextCalled).toBe(true)

    res.statusCode = 200
    res.emit("finish")

    const text = await registry.metrics()
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/api/health",status="200"}',
    )
  })

  it("folds unrouted requests into a bounded label instead of the raw URL", async () => {
    const req = fakeReq({ path: "/api/no-such-route/12345" })
    const { res } = run(httpMetrics, req)
    res.statusCode = 404
    res.emit("finish")

    const text = await registry.metrics()
    expect(text).toContain('route="unmatched"')
    expect(text).not.toContain("no-such-route")
  })
})

describe("metricsAuth", () => {
  it("passes a matching Bearer token", () => {
    process.env.METRICS_TOKEN = "s3cret"
    const { nextCalled } = run(
      metricsAuth,
      fakeReq({ headers: { authorization: "Bearer s3cret" } }),
    )
    expect(nextCalled).toBe(true)
  })

  it("passes Basic auth with the token as the password, any username", () => {
    process.env.METRICS_TOKEN = "s3cret"
    const basic = "Basic " + Buffer.from("grafana:s3cret").toString("base64")
    const { nextCalled } = run(
      metricsAuth,
      fakeReq({ headers: { authorization: basic } }),
    )
    expect(nextCalled).toBe(true)
  })

  it("rejects a missing or wrong credential with 401", () => {
    process.env.METRICS_TOKEN = "s3cret"

    const missing = run(metricsAuth, fakeReq())
    expect(missing.nextCalled).toBe(false)
    expect(missing.res.statusCode).toBe(401)

    const wrong = run(
      metricsAuth,
      fakeReq({ headers: { authorization: "Bearer nope" } }),
    )
    expect(wrong.nextCalled).toBe(false)
    expect(wrong.res.statusCode).toBe(401)
  })

  it("fails CLOSED (404, not 401) when unconfigured in production", () => {
    delete process.env.METRICS_TOKEN
    process.env.NODE_ENV = "production"
    const { res, nextCalled } = run(metricsAuth, fakeReq())
    expect(nextCalled).toBe(false)
    // 404 on purpose: a 401 would confirm the endpoint exists.
    expect(res.statusCode).toBe(404)
  })

  it("fails OPEN when unconfigured in development", () => {
    delete process.env.METRICS_TOKEN
    process.env.NODE_ENV = "test"
    const { nextCalled } = run(metricsAuth, fakeReq())
    expect(nextCalled).toBe(true)
  })
})

describe("metricsHandler", () => {
  it("serves the registry in the Prometheus text format", async () => {
    const res = fakeRes()
    await metricsHandler(fakeReq(), res as unknown as Response)
    expect(res.headers["Content-Type"]).toContain("text/plain")
    expect(String(res.body)).toContain("# TYPE ws_sends_dropped_total counter")
  })
})
