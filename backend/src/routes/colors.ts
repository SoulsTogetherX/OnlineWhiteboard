//#region Imports
import type { Express } from "express"

import { createRequireUser } from "@/auth/requireUser"
import {
  addSavedColor,
  listSavedColors,
  removeSavedColor,
} from "@/db/savedColorRepository"
//#endregion

//#region Validation
// Canonical stored form: "#rrggbbaa" (8 hex digits, alpha included).
const COLOR_RE = /^#[0-9a-fA-F]{8}$/

function isValidColor(input: unknown): input is string {
  return typeof input === "string" && COLOR_RE.test(input)
}
//#endregion

//#region Routes
// The saved palette is an account feature — every route requires a live session.
// Guests keep their palette in localStorage on the client and never call these.
const requireUser = createRequireUser("Log in to use saved colors.")

export default function configureColorRoutes(app: Express): void {
  app.get("/api/colors", async (req, res) => {
    const user = await requireUser(req, res)
    if (!user) return
    res.json({ colors: await listSavedColors(user.id) })
  })

  app.post("/api/colors", async (req, res) => {
    const user = await requireUser(req, res)
    if (!user) return
    const color = req.body?.color
    if (!isValidColor(color)) {
      return res.status(400).json({ error: "Invalid color." })
    }
    res.json({ colors: await addSavedColor(user.id, color.toLowerCase()) })
  })

  app.delete("/api/colors", async (req, res) => {
    const user = await requireUser(req, res)
    if (!user) return
    const color = req.body?.color
    if (!isValidColor(color)) {
      return res.status(400).json({ error: "Invalid color." })
    }
    res.json({ colors: await removeSavedColor(user.id, color.toLowerCase()) })
  })
}
//#endregion
