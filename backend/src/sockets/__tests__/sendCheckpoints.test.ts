// Regression test for incident 002 (docs/incidents/002-flood-crash-and-blind-slo.md).
//
// addClient fires `void this.sendCheckpoints(socket, room)` with no caller to
// catch a rejection. On 2026-09-04 the pool's connect to Postgres timed out
// under load, that promise rejected, and Node's default for an unhandled
// rejection ended the process — dropping every user in every room. The
// checkpoint list is a nicety on join; this pins that losing it costs exactly
// one log line and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/db/checkpointRepository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/checkpointRepository")>()
  return { ...actual, listCheckpoints: vi.fn() }
})

import { listCheckpoints } from "@/db/checkpointRepository"
import { log } from "@/observability/log"
import RoomManager from "@/sockets/roomManager"
import type { ClientSocket } from "@/types/ClientSocket"

type Internals = {
  sendCheckpoints(socket: ClientSocket, room: { roomId: string }): Promise<void>
}

function fakeSocket() {
  return {
    readyState: 1,
    OPEN: 1,
    bufferedAmount: 0,
    send: vi.fn(),
  } as unknown as ClientSocket & { send: ReturnType<typeof vi.fn> }
}

describe("sendCheckpoints", () => {
  const manager = new RoomManager(
    {} as unknown as ConstructorParameters<typeof RoomManager>[0],
  ) as unknown as Internals
  let errorLog: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorLog = vi.spyOn(log, "error").mockImplementation(() => {})
    vi.mocked(listCheckpoints).mockReset()
  })
  afterEach(() => {
    errorLog.mockRestore()
  })

  it("sends the list when the database answers", async () => {
    vi.mocked(listCheckpoints).mockResolvedValue([])
    const socket = fakeSocket()
    await manager.sendCheckpoints(socket, { roomId: "r1" })
    expect(socket.send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(socket.send.mock.calls[0][0] as string)
    expect(payload).toMatchObject({ type: "checkpoints", roomId: "r1" })
    expect(errorLog).not.toHaveBeenCalled()
  })

  it("logs and returns when the database connect fails — never throws", async () => {
    vi.mocked(listCheckpoints).mockRejectedValue(
      new Error("connect ETIMEDOUT 34.217.228.110:5432"),
    )
    const socket = fakeSocket()
    await expect(
      manager.sendCheckpoints(socket, { roomId: "gameday-b" }),
    ).resolves.toBeUndefined()
    expect(socket.send).not.toHaveBeenCalled()
    expect(errorLog).toHaveBeenCalledTimes(1)
    const [msg, fields] = errorLog.mock.calls[0] as [
      string,
      { roomId: string; error: Error },
    ]
    expect(msg).toBe("failed to send checkpoints")
    expect(fields.roomId).toBe("gameday-b")
    expect(fields.error.message).toContain("ETIMEDOUT")
  })

  it("is safe to fire and forget: no unhandled rejection reaches the process", async () => {
    vi.mocked(listCheckpoints).mockRejectedValue(new Error("pool exhausted"))
    const unhandled = vi.fn()
    process.on("unhandledRejection", unhandled)
    try {
      // Exactly the call shape addClient uses.
      void manager.sendCheckpoints(fakeSocket(), { roomId: "r2" })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off("unhandledRejection", unhandled)
    }
  })
})
