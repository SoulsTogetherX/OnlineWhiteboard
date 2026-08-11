//#region Imports
import type { NextFunction, Request, Response } from "express"

// Which header to trust (and why trusting it is safe) lives in clientIp.ts,
// shared with the WebSocket connection caps so both identify clients the same
// way regardless of what proxy fronts the backend.
import { clientAddressOf } from "./clientIp"
//#endregion

//#region Rate limiter
type Bucket = { count: number; resetAt: number }

// A small fixed-window per-IP rate limiter. In-memory, so it is per-process:
// enough to blunt brute-force, credential-stuffing and registration-spam against
// a single instance. Running multiple backend instances would need a shared
// store (Redis) — the same limitation as the in-process room map.
export function rateLimit(options: {
  windowMs: number
  max: number
  name: string
}): (req: Request, res: Response, next: NextFunction) => void {
  const buckets = new Map<string, Bucket>()

  // Drop expired buckets so the map can't grow without bound. unref() so this
  // timer never keeps the process alive on its own.
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key)
      }
    }
  }, options.windowMs)
  sweep.unref?.()

  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${options.name}:${clientAddressOf(req)}`
    const now = Date.now()

    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1

    if (bucket.count > options.max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000)
      res.setHeader("Retry-After", String(retryAfterSec))
      res
        .status(429)
        .json({ error: "Too many attempts. Please try again later." })
      return
    }
    next()
  }
}
//#endregion
