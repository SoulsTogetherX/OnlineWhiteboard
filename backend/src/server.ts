//#region Imports
import express from "express"
import { createServer } from "http"
import { WebSocketServer } from "ws"

import configureRoutes from "./routes"
import configureWebSockets from "./sockets"
//#endregion

//#region Settup App & Sever
const app = express()
const server = createServer(app)
const wss = new WebSocketServer({
  noServer: true,
})

const port = process.env.BACKEND_PORT || 3000
server.listen(port, async () => {
  console.log(`Server is running on ${process.env.API_BASE}:${port}`)
})
//#endregion

//#region Configure
app.use(express.json())
configureRoutes(app)
configureWebSockets(wss, server)
//#endregion
