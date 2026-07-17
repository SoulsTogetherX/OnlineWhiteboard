//#region Imports
import { writeFileSync } from "node:fs"

import { num, parseArgs, str } from "./args"
import {
  printResult,
  runLoadTest,
  type RunOptions,
  type RunResult,
} from "./run"
//#endregion

//#region Helpers
function parseLevels(raw: string): number[] {
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function writeCsv(path: string, rows: RunResult[]): void {
  const header = [
    "clients",
    "connect_succeeded",
    "connect_failed",
    "connect_ms_p50",
    "connect_ms_p95",
    "ready_ms_p50",
    "ready_ms_p95",
    "ping_ms_p50",
    "ping_ms_p95",
    "ping_ms_p99",
    "fanout_ms_p50",
    "fanout_ms_p95",
    "fanout_ms_p99",
    "kb_per_sec",
  ]
  const lines = rows.map((r) =>
    [
      r.options.clients,
      r.connectSucceeded,
      r.connectFailed,
      r.connectMs.p50,
      r.connectMs.p95,
      r.readyMs.p50,
      r.readyMs.p95,
      r.pingMs.p50,
      r.pingMs.p95,
      r.pingMs.p99,
      r.fanoutMs.p50,
      r.fanoutMs.p95,
      r.fanoutMs.p99,
      (r.totalBytesReceived / 1024 / r.durationSec).toFixed(1),
    ].join(","),
  )
  writeFileSync(path, [header.join(","), ...lines].join("\n") + "\n", "utf8")
}
//#endregion

//#region Main
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const url = str(args, "url", "ws://localhost:3000/ws")
  const room = str(args, "room", `ramp-${Date.now()}`)
  const levels = parseLevels(str(args, "levels", "5,10,25,50,100,200"))
  const sameRoom = str(args, "sameRoom", "true") !== "false"
  const failFastConnectRate = num(args, "failFastConnectRate", 0.1)
  const failFastPingMs = num(args, "failFastPingMs", 3000)
  const csvPath = str(args, "csv", "loadtest-results.csv")

  const shared = {
    url,
    drawerRatio: num(args, "drawerRatio", 0.2),
    drawIntervalMs: num(args, "drawIntervalMs", 200),
    pingIntervalMs: num(args, "pingIntervalMs", 1000),
    connectStaggerMs: num(args, "connectStaggerMs", 10),
    connectTimeoutMs: num(args, "connectTimeoutMs", 5000),
    durationMs: num(args, "durationMs", 20_000),
  }

  console.log(
    `[ramp] levels=${levels.join(",")}  sameRoom=${sameRoom}  (Ctrl+C to stop early)`,
  )

  const rows: RunResult[] = []

  for (const level of levels) {
    const roomId = sameRoom ? room : `${room}-L${level}`
    const options: RunOptions = { ...shared, roomId, clients: level }

    const result = await runLoadTest(options)
    printResult(result)
    rows.push(result)
    writeCsv(csvPath, rows) // write after every level so partial runs still leave data

    const connectFailRate = result.connectFailed / result.connectAttempted
    if (connectFailRate > failFastConnectRate) {
      console.warn(
        `\n[ramp] stopping: ${(connectFailRate * 100).toFixed(0)}% of connections failed at ${level} clients.`,
      )
      break
    }
    if (result.pingMs.p95 > failFastPingMs) {
      console.warn(
        `\n[ramp] stopping: p95 ping latency exceeded ${failFastPingMs}ms at ${level} clients.`,
      )
      break
    }

    await sleep(1000) // brief cooldown between levels
  }

  console.log(`\n[ramp] wrote ${rows.length} row(s) to ${csvPath}`)
  process.exit(0)
}

main()
//#endregion
