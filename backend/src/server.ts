//#region Imports
import express from "express"
import { createServer } from "http"

import configureRoutes from "./routes"
//#endregion

//#region Settup App & Sever
const app = express()
const server = createServer(app)

const port = process.env.BACKEND_PORT || 3000
server.listen(port, async () => {
  console.log(`Server is running on ${process.env.API_BASE}:${port}`)
})
//#endregion

//#region Configure
configureRoutes(app)
//#endregion
