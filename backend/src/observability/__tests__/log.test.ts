import { afterEach, describe, expect, it } from "vitest"

import { createLogger } from "../log"

// Pure unit test — no database, no network. The logger's whole contract is
// "one parseable JSON object per line, on the right stream, above the floor",
// so that is exactly what is asserted.

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

type Captured = { line: string; level: string }

function capturingLogger(bindings?: Record<string, unknown>) {
  const lines: Captured[] = []
  const logger = createLogger(bindings ?? {}, (line, level) =>
    lines.push({ line, level }),
  )
  return { logger, lines }
}

describe("createLogger", () => {
  it("emits one JSON object with time, level, msg and fields", () => {
    const { logger, lines } = capturingLogger()
    logger.info("server listening", { port: 3000 })

    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0].line)
    expect(parsed).toMatchObject({ level: "info", msg: "server listening", port: 3000 })
    // ISO-8601 — the shape every log platform parses without configuration.
    expect(new Date(parsed.time).toISOString()).toBe(parsed.time)
  })

  it("merges child bindings into every line, with call fields winning", () => {
    const { logger, lines } = capturingLogger()
    const child = logger.child({ roomId: "abc", module: "x" })
    child.warn("slow flush", { module: "y" })

    expect(JSON.parse(lines[0].line)).toMatchObject({
      roomId: "abc",
      module: "y",
      msg: "slow flush",
    })
  })

  it("expands Error fields into name/message/stack", () => {
    const { logger, lines } = capturingLogger()
    logger.error("failed", { error: new Error("boom") })

    const parsed = JSON.parse(lines[0].line)
    expect(parsed.error.name).toBe("Error")
    expect(parsed.error.message).toBe("boom")
    expect(typeof parsed.error.stack).toBe("string")
  })

  it("drops lines below the LOG_LEVEL floor, read per call", () => {
    const { logger, lines } = capturingLogger()

    process.env.LOG_LEVEL = "warn"
    logger.info("invisible")
    logger.debug("also invisible")
    logger.warn("visible")

    // Per-call read: lowering the floor re-enables info WITHOUT re-creating
    // the logger.
    process.env.LOG_LEVEL = "debug"
    logger.debug("now visible")

    expect(lines.map((l) => JSON.parse(l.line).msg)).toEqual([
      "visible",
      "now visible",
    ])
  })

  it("reports the level to the sink so warn/error can route to stderr", () => {
    const { logger, lines } = capturingLogger()
    logger.info("a")
    logger.error("b")
    expect(lines.map((l) => l.level)).toEqual(["info", "error"])
  })
})
