//#region Imports
import type { NextFunction, Request, Response } from "express"
//#endregion

//#region Client IP
// nginx sets X-Real-IP to the true client address (see nginx.conf.template); in
// dev there's no nginx so we fall back to the socket address. Trusting the header
// is safe because in production the backend publishes NO host port — it is
// reachable only through nginx on the private network, so nothing external can
// forge X-Real-IP.
function clientIp(req: Request): string {
  const header = req.headers["x-real-ip"]
  if (typeof header === "string" && header.length > 0) {
    return header
  }
  return req.socket.remoteAddress ?? "unknown"
}
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
    const key = `${options.name}:${clientIp(req)}`
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
