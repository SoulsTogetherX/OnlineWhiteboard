//#region Imports
import type { NextFunction, Request, Response } from "express"

import { isAllowedOrigin } from "./origin"
//#endregion

//#region CSRF Origin guard
// Rejects state-changing requests whose Origin isn't on the allowlist. This is
// defence-in-depth on top of the SameSite=Lax session cookie (which already
// stops the cookie riding along on cross-site POSTs in modern browsers).
//
// Only "unsafe" methods are checked — GET/HEAD/OPTIONS don't change state, so a
// cross-origin GET is harmless and blocking it would break ordinary navigation.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function csrfOriginGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) {
    next()
    return
  }
  if (isAllowedOrigin(req.headers.origin)) {
    next()
    return
  }
  res.status(403).json({ error: "Cross-origin request rejected." })
}
//#endregion
