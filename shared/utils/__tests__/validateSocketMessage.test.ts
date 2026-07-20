// Tests for the network trust boundary: the message envelope and the one
// unbounded list that per-item validation could not protect.
//
// These exist because `as ClientSocketMessage` looked like validation and was
// not. Each case here is something that previously reached a handler untouched.

import { describe, expect, it } from "vitest"

import { isValidClientMessage } from "../validateSocketMessage"
import { isValidDrawInstruction } from "../validateInstruction"
import { MAX_PATCH_ENTRIES } from "../../constants/canvas"
import {
  MAX_CHECKPOINT_NAME_LENGTH,
  MAX_ID_LENGTH,
  MAX_ROOM_ID_LENGTH,
} from "../../constants/protocol"

const validDraw = {
  type: "pencil",
  prevPos: [0, 0],
  nextPos: [5, 5],
  instructionId: 1,
  sessionId: "session-a",
}

const patchEntry = (idx: number) => ({
  idx,
  from: { r: 0, g: 0, b: 0, a: 0 },
  to: { r: 255, g: 255, b: 255, a: 255 },
})

describe("isValidClientMessage — non-objects", () => {
  it("rejects anything that is not an object", () => {
    for (const value of [null, undefined, "draw", 42, true, []]) {
      expect(isValidClientMessage(value)).toBe(false)
    }
  })

  it("rejects an unknown message type (allow-list, not deny-list)", () => {
    expect(isValidClientMessage({ type: "drop_database", roomId: "r" })).toBe(
      false,
    )
    // No type at all.
    expect(isValidClientMessage({ roomId: "r" })).toBe(false)
  })
})

describe("isValidClientMessage — ping", () => {
  it("accepts a numeric sentAt", () => {
    expect(isValidClientMessage({ type: "ping", sentAt: 123 })).toBe(true)
  })

  it("rejects a missing or non-finite sentAt", () => {
    expect(isValidClientMessage({ type: "ping" })).toBe(false)
    expect(isValidClientMessage({ type: "ping", sentAt: NaN })).toBe(false)
    expect(isValidClientMessage({ type: "ping", sentAt: Infinity })).toBe(false)
    expect(isValidClientMessage({ type: "ping", sentAt: "now" })).toBe(false)
  })
})

describe("isValidClientMessage — roomId bounds", () => {
  it("accepts a roomId at the limit and rejects one past it", () => {
    const atLimit = "r".repeat(MAX_ROOM_ID_LENGTH)
    const tooLong = "r".repeat(MAX_ROOM_ID_LENGTH + 1)
    expect(isValidClientMessage({ type: "resync", roomId: atLimit })).toBe(true)
    expect(isValidClientMessage({ type: "resync", roomId: tooLong })).toBe(false)
  })

  it("rejects an empty or non-string roomId", () => {
    expect(isValidClientMessage({ type: "resync", roomId: "" })).toBe(false)
    expect(isValidClientMessage({ type: "resync", roomId: 7 })).toBe(false)
    expect(isValidClientMessage({ type: "resync" })).toBe(false)
  })
})

describe("isValidClientMessage — draw", () => {
  it("accepts a well-formed draw", () => {
    expect(
      isValidClientMessage({ type: "draw", roomId: "r", instruction: validDraw }),
    ).toBe(true)
  })

  it("rejects a draw whose instruction is malformed", () => {
    // Out of bounds — the instruction guard's job, reached through the envelope.
    expect(
      isValidClientMessage({
        type: "draw",
        roomId: "r",
        instruction: { ...validDraw, nextPos: [1e9, 1e9] },
      }),
    ).toBe(false)
    expect(
      isValidClientMessage({ type: "draw", roomId: "r", instruction: null }),
    ).toBe(false)
    expect(isValidClientMessage({ type: "draw", roomId: "r" })).toBe(false)
  })
})

describe("isValidClientMessage — cursor", () => {
  it("accepts null (pointer left the canvas) and a valid vector", () => {
    expect(isValidClientMessage({ type: "cursor", roomId: "r", pos: null })).toBe(
      true,
    )
    expect(
      isValidClientMessage({ type: "cursor", roomId: "r", pos: [3, 4] }),
    ).toBe(true)
  })

  it("rejects an out-of-bounds or malformed position", () => {
    expect(
      isValidClientMessage({ type: "cursor", roomId: "r", pos: [-1, 0] }),
    ).toBe(false)
    expect(
      isValidClientMessage({ type: "cursor", roomId: "r", pos: [1e9, 1e9] }),
    ).toBe(false)
    expect(
      isValidClientMessage({ type: "cursor", roomId: "r", pos: "middle" }),
    ).toBe(false)
    expect(isValidClientMessage({ type: "cursor", roomId: "r" })).toBe(false)
  })
})

describe("isValidClientMessage — room actions and votes", () => {
  it("accepts only the known action", () => {
    expect(
      isValidClientMessage({ type: "request_action", roomId: "r", action: "clear" }),
    ).toBe(true)
    expect(
      isValidClientMessage({ type: "request_action", roomId: "r", action: "drop" }),
    ).toBe(false)
    expect(isValidClientMessage({ type: "request_action", roomId: "r" })).toBe(
      false,
    )
  })

  it("requires a boolean approve on a vote", () => {
    expect(
      isValidClientMessage({
        type: "vote",
        roomId: "r",
        voteId: "v1",
        approve: true,
      }),
    ).toBe(true)
    // Truthy but not a boolean — the exact shape a loose check would let through.
    expect(
      isValidClientMessage({
        type: "vote",
        roomId: "r",
        voteId: "v1",
        approve: "yes",
      }),
    ).toBe(false)
  })
})

describe("isValidClientMessage — checkpoints", () => {
  it("bounds the checkpoint name", () => {
    const atLimit = "n".repeat(MAX_CHECKPOINT_NAME_LENGTH)
    const tooLong = "n".repeat(MAX_CHECKPOINT_NAME_LENGTH + 1)
    expect(
      isValidClientMessage({ type: "create_checkpoint", roomId: "r", name: atLimit }),
    ).toBe(true)
    expect(
      isValidClientMessage({ type: "create_checkpoint", roomId: "r", name: tooLong }),
    ).toBe(false)
    expect(
      isValidClientMessage({ type: "create_checkpoint", roomId: "r", name: "" }),
    ).toBe(false)
  })

  it("bounds checkpoint ids on restore and delete", () => {
    const tooLong = "c".repeat(MAX_ID_LENGTH + 1)
    for (const type of ["restore_checkpoint", "delete_checkpoint"]) {
      expect(isValidClientMessage({ type, roomId: "r", checkpointId: "c1" })).toBe(
        true,
      )
      expect(
        isValidClientMessage({ type, roomId: "r", checkpointId: tooLong }),
      ).toBe(false)
      expect(isValidClientMessage({ type, roomId: "r" })).toBe(false)
    }
  })

  it("treats fromCheckpointId as optional on playback", () => {
    expect(isValidClientMessage({ type: "request_playback", roomId: "r" })).toBe(
      true,
    )
    expect(
      isValidClientMessage({
        type: "request_playback",
        roomId: "r",
        fromCheckpointId: "c1",
      }),
    ).toBe(true)
    expect(
      isValidClientMessage({
        type: "request_playback",
        roomId: "r",
        fromCheckpointId: 5,
      }),
    ).toBe(false)
  })
})

describe("patch entry-count bound (memory DoS)", () => {
  // Per-entry validation bounds what ONE entry can do. Only a length check
  // bounds how many there are. Without this, a single message could carry
  // millions of entries for the server to parse and iterate.
  it("accepts a patch covering every pixel exactly once", () => {
    const entries = Array.from({ length: MAX_PATCH_ENTRIES }, (_, i) =>
      patchEntry(i * 4),
    )
    expect(
      isValidDrawInstruction({
        type: "patch",
        entries,
        instructionId: 1,
        sessionId: "s",
      }),
    ).toBe(true)
  })

  it("rejects a patch with more entries than the canvas has pixels", () => {
    const entries = Array.from({ length: MAX_PATCH_ENTRIES + 1 }, () =>
      patchEntry(0),
    )
    expect(
      isValidDrawInstruction({
        type: "patch",
        entries,
        instructionId: 1,
        sessionId: "s",
      }),
    ).toBe(false)
  })

  it("rejects an oversized patch through the envelope too", () => {
    const entries = Array.from({ length: MAX_PATCH_ENTRIES + 1 }, () =>
      patchEntry(0),
    )
    expect(
      isValidClientMessage({
        type: "draw",
        roomId: "r",
        instruction: {
          type: "patch",
          entries,
          instructionId: 1,
          sessionId: "s",
        },
      }),
    ).toBe(false)
  })
})
