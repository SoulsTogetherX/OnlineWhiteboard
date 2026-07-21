//#region Imports
import { pathToFileURL } from "node:url"

import { DEFAULT_CANVAS_DIMS, canvasBytes } from "@shared/constants/canvas"

import { num, parseArgs, str } from "./args"
import { SimulatedClient, type PendingMap } from "./client"
import { summarize, type Summary } from "./stats"
//#endregion

//#region Types
export type RunOptions = {
  url: string
  roomId: string
  clients: number
  drawerRatio: number
  drawIntervalMs: number
  pingIntervalMs: number
  connectStaggerMs: number
  connectTimeoutMs: number
  durationMs: number
}

export type RunResult = {
  options: RunOptions
  connectAttempted: number
  connectSucceeded: number
  connectFailed: number
  connectMs: Summary
  readyMs: Summary
  pingMs: Summary
  fanoutMs: Summary
  totalMessagesReceived: number
  totalBytesReceived: number
  totalSnapshotBytesReceived: number
  durationSec: number
}
//#endregion

//#region Run
export async function runLoadTest(options: RunOptions): Promise<RunResult> {
  const pending: PendingMap = new Map()
  // Bound memory on long runs: an instruction that never got matched to a
  // recipient after 10s isn't going to be (the room's long-since moved on).
  const pruneTimer = setInterval(() => {
    const cutoff = Date.now() - 10_000
    for (const [key, sentAt] of pending) {
      if (sentAt < cutoff) pending.delete(key)
    }
  }, 5_000)

  const clients: SimulatedClient[] = []
  let connectSucceeded = 0
  let connectFailed = 0

  console.log(
    `\n[run] connecting ${options.clients} client(s) to room "${options.roomId}" ...`,
  )

  const connectPromises: Promise<void>[] = []
  for (let i = 0; i < options.clients; i++) {
    const isDrawer = i < Math.ceil(options.clients * options.drawerRatio)
    const client = new SimulatedClient(
      {
        id: i,
        url: options.url,
        roomId: options.roomId,
        isDrawer,
        drawIntervalMs: options.drawIntervalMs,
        pingIntervalMs: options.pingIntervalMs,
        connectTimeoutMs: options.connectTimeoutMs,
      },
      pending,
    )
    clients.push(client)

    const p = client
      .connect()
      .then(() => {
        connectSucceeded += 1
        client.start()
      })
      .catch(() => {
        connectFailed += 1
      })
    connectPromises.push(p)

    // Stagger connection attempts slightly so we're measuring steady-state
    // capacity rather than a simultaneous connection-storm artifact.
    if (options.connectStaggerMs > 0) {
      await sleep(options.connectStaggerMs)
    }
  }

  await Promise.all(connectPromises)
  console.log(
    `[run] connected ${connectSucceeded}/${options.clients} (${connectFailed} failed) — running for ${options.durationMs}ms ...`,
  )

  await sleep(options.durationMs)

  clearInterval(pruneTimer)
  clients.forEach((c) => c.stop())
  await sleep(300) // let close frames flush before we read final metrics

  const connectMsValues = clients
    .map((c) => c.metrics.connectMs)
    .filter((v): v is number => v !== null)
  const readyMsValues = clients
    .map((c) => c.metrics.readyMs)
    .filter((v): v is number => v !== null)
  const pingValues = clients.flatMap((c) => c.metrics.pingLatencies)
  const fanoutValues = clients.flatMap((c) => c.metrics.fanoutLatencies)

  return {
    options,
    connectAttempted: options.clients,
    connectSucceeded,
    connectFailed,
    connectMs: summarize(connectMsValues),
    readyMs: summarize(readyMsValues),
    pingMs: summarize(pingValues),
    fanoutMs: summarize(fanoutValues),
    totalMessagesReceived: clients.reduce(
      (a, c) => a + c.metrics.messagesReceived,
      0,
    ),
    totalBytesReceived: clients.reduce(
      (a, c) => a + c.metrics.bytesReceived,
      0,
    ),
    totalSnapshotBytesReceived: clients.reduce(
      (a, c) => a + c.metrics.snapshotBytesReceived,
      0,
    ),
    durationSec: options.durationMs / 1000,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
//#endregion

//#region Reporting
export function printResult(result: RunResult): void {
  const fmt = (s: Summary): string =>
    `p50=${s.p50}ms  p95=${s.p95}ms  p99=${s.p99}ms  max=${s.max}ms  (n=${s.count})`

  const kbps = (result.totalBytesReceived / 1024 / result.durationSec).toFixed(
    1,
  )
  const snapshotKb = (result.totalSnapshotBytesReceived / 1024).toFixed(1)
  const canvasKb = (
    (canvasBytes(DEFAULT_CANVAS_DIMS) * 4) /
    3 /
    1024
  ).toFixed(1) // base64 size

  console.log(
    `\n=== Room "${result.options.roomId}" — ${result.options.clients} clients ===`,
  )
  console.log(
    `connected:      ${result.connectSucceeded}/${result.connectAttempted} (${result.connectFailed} failed)`,
  )
  console.log(`connect time:   ${fmt(result.connectMs)}`)
  console.log(`ready time:     ${fmt(result.readyMs)}`)
  console.log(`ping RTT:       ${fmt(result.pingMs)}`)
  console.log(`draw fan-out:   ${fmt(result.fanoutMs)}`)
  console.log(
    `throughput:     ${result.totalMessagesReceived} msgs, ${(result.totalBytesReceived / 1024).toFixed(1)} KB over ${result.durationSec}s (~${kbps} KB/s)`,
  )
  // This line used to claim snapshots were "sent to every client every 10s".
  // That stopped being true when the server replaced its periodic full-canvas
  // broadcast with the tiny `revision_check` heartbeat: snapshots are now sent
  // only on connect, and on an explicit `resync` from a client that has fallen
  // behind. The measured number was therefore just the connect-time snapshots,
  // described as something else entirely.
  console.log(
    `  snapshot share: ${snapshotKb} KB (~${canvasKb} KB base64 each, one per client on connect)`,
  )
  console.log(
    `  NOTE: this harness never sends "resync", so the on-demand snapshot path is not exercised.`,
  )
}
//#endregion

//#region CLI
// pathToFileURL, not a hand-built `file://${...}` template. On Windows
// process.argv[1] is `C:\path\to\run.ts`, so the template produced
// `file://C:\path\to\run.ts` while import.meta.url is `file:///C:/path/to/run.ts`
// — they never matched, so `npm run run` silently did nothing and exited 0.
// (`ramp` was unaffected: it calls main() unconditionally.)
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const options: RunOptions = {
    url: str(args, "url", "ws://localhost:3000/ws"),
    roomId: str(args, "room", `loadtest-${Date.now()}`),
    clients: num(args, "clients", 50),
    drawerRatio: num(args, "drawerRatio", 0.2),
    drawIntervalMs: num(args, "drawIntervalMs", 200),
    pingIntervalMs: num(args, "pingIntervalMs", 1000),
    connectStaggerMs: num(args, "connectStaggerMs", 10),
    connectTimeoutMs: num(args, "connectTimeoutMs", 5000),
    durationMs: num(args, "durationMs", 30_000),
  }

  runLoadTest(options).then((result) => {
    printResult(result)
    process.exit(0)
  })
}
//#endregion
