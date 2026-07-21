// Flood-control tests.
//
// The headline case is the FIRST one: a legitimate client drawing as fast as the
// hardware allows must never be throttled. A rate limiter that protects the
// server by breaking normal drawing has not solved the problem, it has moved it.

import { describe, expect, it } from "vitest"

import {
  BURST_CAPACITY,
  ConnectionCounter,
  INVALID_MESSAGE_COST,
  MAX_CONNECTIONS_PER_IP,
  MAX_CONNECTIONS_PER_USER,
  MAX_VIOLATIONS_BEFORE_CLOSE,
  SUSTAINED_UNITS_PER_SEC,
  SocketRateLimiter,
  connectionKey,
  messageCost,
} from "../socketLimits"

import { SESSION_COOKIE } from "@/auth/cookies"

import type { ClientSocketMessage } from "@shared/types/socketProtocol"

const pencil: ClientSocketMessage = {
  type: "draw",
  roomId: "r",
  instruction: {
    type: "pencil",
    prevPos: [0, 0],
    nextPos: [1, 1],
    instructionId: 1,
    sessionId: "s",
  },
}

const bucket: ClientSocketMessage = {
  type: "draw",
  roomId: "r",
  instruction: {
    type: "bucket",
    pos: [0, 0],
    instructionId: 1,
    sessionId: "s",
  },
}

const cursor: ClientSocketMessage = { type: "cursor", roomId: "r", pos: [1, 1] }
const ping: ClientSocketMessage = { type: "ping", sentAt: 0 }

describe("legitimate drawing is never throttled", () => {
  // The realistic worst case: a 120Hz pointer emitting one draw per move, plus
  // the client-side-throttled cursor stream (~22/s), sustained for 30 seconds.
  it("allows a fast 120Hz scribble plus cursors for 30 seconds straight", () => {
    const limiter = new SocketRateLimiter()
    const socket = {}
    let now = 0
    let dropped = 0

    // 30 seconds, stepped in 1000 slices of 30ms.
    for (let tick = 0; tick < 1000; tick += 1) {
      now += 30
      // 30ms at 120Hz is ~3.6 draws; send 4 to be pessimistic.
      for (let i = 0; i < 4; i += 1) {
        if (limiter.consume(socket, messageCost(pencil), now) !== "allow") {
          dropped += 1
        }
      }
      // A cursor update lands roughly every other tick (45ms throttle).
      if (tick % 2 === 0) {
        if (limiter.consume(socket, messageCost(cursor), now) !== "allow") {
          dropped += 1
        }
      }
    }

    expect(dropped).toBe(0)
  })

  it("never charges for ping, so liveness checks can't be rate limited away", () => {
    expect(messageCost(ping)).toBe(0)

    const limiter = new SocketRateLimiter()
    const socket = {}
    // Drain the bucket completely.
    limiter.consume(socket, BURST_CAPACITY, 0)
    // Ping still answered on an empty bucket.
    expect(limiter.consume(socket, messageCost(ping), 0)).toBe("allow")
  })
})

describe("floods are throttled", () => {
  it("drops once the burst capacity is spent within one instant", () => {
    const limiter = new SocketRateLimiter()
    const socket = {}
    let allowed = 0
    // All at the same timestamp, so no refill can occur.
    for (let i = 0; i < BURST_CAPACITY + 200; i += 1) {
      if (limiter.consume(socket, 1, 0) === "allow") {
        allowed += 1
      }
    }
    expect(allowed).toBe(BURST_CAPACITY)
  })

  it("refills over time at the sustained rate", () => {
    const limiter = new SocketRateLimiter()
    const socket = {}
    limiter.consume(socket, BURST_CAPACITY, 0) // empty it
    expect(limiter.consume(socket, 1, 0)).toBe("drop")

    // One second later, roughly SUSTAINED_UNITS_PER_SEC tokens are back.
    let allowed = 0
    for (let i = 0; i < SUSTAINED_UNITS_PER_SEC; i += 1) {
      if (limiter.consume(socket, 1, 1000) === "allow") {
        allowed += 1
      }
    }
    expect(allowed).toBe(SUSTAINED_UNITS_PER_SEC)
  })

  it("closes only after SUSTAINED abuse, not a brief overshoot", () => {
    const limiter = new SocketRateLimiter()
    const socket = {}
    limiter.consume(socket, BURST_CAPACITY, 0)

    // A short overshoot drops but must never close.
    for (let i = 0; i < 10; i += 1) {
      expect(limiter.consume(socket, 1, 0)).toBe("drop")
    }

    // Keep hammering the empty bucket until the violation budget is spent.
    let sawClose = false
    for (let i = 0; i < MAX_VIOLATIONS_BEFORE_CLOSE + 10; i += 1) {
      if (limiter.consume(socket, 1, 0) === "close") {
        sawClose = true
        break
      }
    }
    expect(sawClose).toBe(true)
  })

  it("forgives violations once the client behaves again", () => {
    const limiter = new SocketRateLimiter()
    const socket = {}
    limiter.consume(socket, BURST_CAPACITY, 0) // empty it

    // Rack up violations, stopping just short of the close threshold.
    const racked = MAX_VIOLATIONS_BEFORE_CLOSE - 10
    for (let i = 0; i < racked; i += 1) {
      expect(limiter.consume(socket, 1, 0)).toBe("drop")
    }

    // Behave: every allowed message forgives one violation.
    for (let i = 0; i < racked; i += 1) {
      expect(limiter.consume(socket, 1, 10_000 + i * 100)).toBe("allow")
    }

    // Abuse again from a full bucket. If the earlier violations had merely been
    // paused rather than forgiven, this would close almost immediately. It must
    // instead take the FULL violation budget — that is what "forgiven" means.
    //
    // Comfortably after the behave loop's last timestamp (10_000 + racked*100),
    // so the bucket has refilled to capacity. Time only ever moves forward here.
    const t = 60_000
    expect(limiter.consume(socket, BURST_CAPACITY, t)).toBe("allow")

    let drops = 0
    let closed = false
    for (let i = 0; i < MAX_VIOLATIONS_BEFORE_CLOSE + 5; i += 1) {
      if (limiter.consume(socket, 1, t) === "close") {
        closed = true
        break
      }
      drops += 1
    }
    expect(closed).toBe(true)
    expect(drops).toBe(MAX_VIOLATIONS_BEFORE_CLOSE - 1)
  })

  it("spends nothing when it rejects — a refused message costs no tokens", () => {
    // Token-bucket semantics: you cannot partially spend. This is why an
    // oversized consume against a partly-full bucket leaves it untouched rather
    // than draining it to zero.
    const limiter = new SocketRateLimiter()
    const socket = {}
    limiter.consume(socket, BURST_CAPACITY, 0)
    // Half a second of refill: enough for some messages, not for a full burst.
    const partial = SUSTAINED_UNITS_PER_SEC / 2
    expect(limiter.consume(socket, BURST_CAPACITY, 500)).toBe("drop")
    // Those tokens are still there.
    let allowed = 0
    for (let i = 0; i < partial; i += 1) {
      if (limiter.consume(socket, 1, 500) === "allow") {
        allowed += 1
      }
    }
    expect(allowed).toBe(partial)
  })

  it("meters each socket independently", () => {
    const limiter = new SocketRateLimiter()
    const a = {}
    const b = {}
    limiter.consume(a, BURST_CAPACITY, 0)
    expect(limiter.consume(a, 1, 0)).toBe("drop")
    // b is untouched by a's abuse.
    expect(limiter.consume(b, 1, 0)).toBe("allow")
  })
})

describe("cost reflects server work, not message size", () => {
  it("charges a flood fill far more than a pencil stroke", () => {
    // A bucket can repaint the whole canvas from one tiny message.
    expect(messageCost(bucket)).toBeGreaterThan(messageCost(pencil))
  })

  it("scales patch cost with the number of entries", () => {
    const makePatch = (n: number): ClientSocketMessage => ({
      type: "draw",
      roomId: "r",
      instruction: {
        type: "patch",
        entries: Array.from({ length: n }, () => ({
          idx: 0,
          from: { r: 0, g: 0, b: 0, a: 0 },
          to: { r: 1, g: 1, b: 1, a: 1 },
        })),
        instructionId: 1,
        sessionId: "s",
      },
    })
    expect(messageCost(makePatch(10000))).toBeGreaterThan(
      messageCost(makePatch(10)),
    )
  })

  it("charges database-backed operations heavily", () => {
    const playback: ClientSocketMessage = {
      type: "request_playback",
      roomId: "r",
    }
    expect(messageCost(playback)).toBeGreaterThan(messageCost(bucket))
  })

  it("charges invalid messages more than valid ones (anti-amplification)", () => {
    expect(INVALID_MESSAGE_COST).toBeGreaterThan(messageCost(pencil))
  })
})

describe("connection cap", () => {
  it("permits up to the authenticated limit and refuses beyond it", () => {
    const counter = new ConnectionCounter()
    for (let i = 0; i < MAX_CONNECTIONS_PER_USER; i += 1) {
      expect(counter.tryAcquire("s:abc", true)).toBe(true)
    }
    expect(counter.tryAcquire("s:abc", true)).toBe(false)
  })

  it("is far looser for IP keys, because NAT puts real users behind one address", () => {
    expect(MAX_CONNECTIONS_PER_IP).toBeGreaterThan(MAX_CONNECTIONS_PER_USER)

    const counter = new ConnectionCounter()
    for (let i = 0; i < MAX_CONNECTIONS_PER_IP; i += 1) {
      expect(counter.tryAcquire("ip:1.2.3.4", false)).toBe(true)
    }
    expect(counter.tryAcquire("ip:1.2.3.4", false)).toBe(false)
  })

  it("frees a slot on release and forgets the key at zero", () => {
    const counter = new ConnectionCounter()
    counter.tryAcquire("s:abc", true)
    expect(counter.count("s:abc")).toBe(1)
    counter.release("s:abc")
    expect(counter.count("s:abc")).toBe(0)
    // Reusable afterwards.
    expect(counter.tryAcquire("s:abc", true)).toBe(true)
  })

  it("counts identities separately", () => {
    const counter = new ConnectionCounter()
    for (let i = 0; i < MAX_CONNECTIONS_PER_USER; i += 1) {
      counter.tryAcquire("s:abc", true)
    }
    expect(counter.tryAcquire("s:abc", true)).toBe(false)
    expect(counter.tryAcquire("s:xyz", true)).toBe(true)
  })
})

describe("connectionKey", () => {
  const req = (headers: Record<string, string>) =>
    ({
      headers,
      socket: { remoteAddress: "10.0.0.1" },
    }) as never

  it("keys a logged-in visitor by a HASH of their session cookie", () => {
    // Built from the constant, not a hardcoded "sid": the cookie name differs
    // between dev and production (__Host- prefix), and a hardcoded name would
    // make this test quietly environment-dependent.
    const { key, isAuthenticated } = connectionKey(
      req({ cookie: `${SESSION_COOKIE}=super-secret-token` }),
    )
    expect(isAuthenticated).toBe(true)
    expect(key.startsWith("s:")).toBe(true)
    // The raw token must never end up as a map key.
    expect(key).not.toContain("super-secret-token")
  })

  it("falls back to IP for guests, preferring the proxy header", () => {
    const viaProxy = connectionKey(req({ "x-real-ip": "203.0.113.9" }))
    expect(viaProxy).toEqual({ key: "ip:203.0.113.9", isAuthenticated: false })

    const direct = connectionKey(req({}))
    expect(direct).toEqual({ key: "ip:10.0.0.1", isAuthenticated: false })
  })
})
