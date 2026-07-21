//#region Imports
import { readSessionToken, resolveSessionUser } from "./session"

import type { Request, Response } from "express"
import type { User } from "@/db/userRepository"
//#endregion

//#region Require User
// Builds the "must be logged in" guard used by the account-only route groups
// (saved colours, room membership).
//
// Contract: resolves to the User, or to null HAVING ALREADY SENT a 401. So the
// call site reads:
//
//     const user = await requireUser(req, res)
//     if (!user) return
//
// A factory rather than a single shared function because the only thing that
// differed between the two hand-copied versions was the 401 message, which is
// user-facing and route-group specific. Parameterising that keeps the wording
// while removing the duplicated session lookup.
export function createRequireUser(
  message: string,
): (req: Request, res: Response) => Promise<User | null> {
  return async function requireUser(req, res) {
    const user = await resolveSessionUser(readSessionToken(req))
    if (!user) {
      res.status(401).json({ error: message })
      return null
    }
    return user
  }
}
//#endregion
