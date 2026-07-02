//#region Imports
import express, { Express } from "express"
//#endregion

//#region Configure Routes
function configure(app: Express) {
  app.use(express.json({ limit: "2mb" }))

  app.post("/api", async (req, res) => {
    res.status(200).json({ success: true })
  })
}
//#endregion

//#region exports
export default configure
//#endregion
