//#region Why this exists
// `RoomManager.parseMessage` used to do `JSON.parse(text) as ClientSocketMessage`.
// An `as` cast is a compile-time assertion, not a runtime check: it tells the
// type system to stop asking questions and does nothing at all when the program
// runs. So the ENVELOPE — the message type, roomId, and every field beside the
// instruction — reached the handlers completely unverified.
//
// `validateInstruction.ts` already guarded the instruction payload, because that
// is what reaches the pixel writers. This guards everything around it. Together
// they mean nothing from the network is trusted anywhere.
//
// The design rule (OWASP WebSocket guidance): validate message STRUCTURE against
// an allow-list of known shapes, never a deny-list of bad ones. An unknown `type`
// is rejected outright rather than falling through to a default handler.
//
// It lives in shared/ so the same definition of "a well-formed message" is
// available to the server, to tests, and to any future client that needs it.
//#endregion

//#region Imports
import {
  MAX_CHECKPOINT_NAME_LENGTH,
  MAX_ID_LENGTH,
  MAX_ROOM_ID_LENGTH,
} from "../constants/protocol"
import { isValidDrawInstruction, isValidVec } from "./validateInstruction"

import type { ClientSocketMessage } from "../types/socketProtocol"
//#endregion

//#region Primitive Guards
function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
}

// Number.isFinite rejects NaN and both infinities, which a bare `typeof number`
// check would let through.
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isRoomId(value: unknown): value is string {
  return isBoundedString(value, MAX_ROOM_ID_LENGTH)
}

function isId(value: unknown): value is string {
  return isBoundedString(value, MAX_ID_LENGTH)
}
//#endregion

//#region Message Guard
// Returns false for anything that is not a well-formed client message. Callers
// treat false as "drop it": no handler runs, no state changes.
//
// Note this validates SHAPE, not AUTHORITY. "Is this a syntactically valid
// create_checkpoint?" is answered here; "is this connection allowed to create
// one?" is answered by the role check in the handler. Conflating the two is how
// authorisation bugs get written, so they stay deliberately separate.
export function isValidClientMessage(
  value: unknown,
): value is ClientSocketMessage {
  if (!value || typeof value !== "object") {
    return false
  }

  const message = value as { type?: unknown; roomId?: unknown } & Record<
    string,
    unknown
  >

  switch (message.type) {
    // ping is the one message with no roomId — it is answered before the room is
    // even resolved, which is what makes it usable during the room-load window.
    case "ping":
      return isFiniteNumber(message.sentAt)

    case "draw":
      return (
        isRoomId(message.roomId) && isValidDrawInstruction(message.instruction)
      )

    case "resync":
      return isRoomId(message.roomId)

    case "cursor":
      // null is meaningful: "my pointer left the canvas". Any other value must
      // be a valid in-bounds vector.
      return (
        isRoomId(message.roomId) &&
        (message.pos === null || isValidVec(message.pos))
      )

    case "request_action":
      return isRoomId(message.roomId) && message.action === "clear"

    case "vote":
      return (
        isRoomId(message.roomId) &&
        isId(message.voteId) &&
        typeof message.approve === "boolean"
      )

    case "create_checkpoint":
      return (
        isRoomId(message.roomId) &&
        isBoundedString(message.name, MAX_CHECKPOINT_NAME_LENGTH)
      )

    case "restore_checkpoint":
    case "delete_checkpoint":
      return isRoomId(message.roomId) && isId(message.checkpointId)

    case "request_playback":
      // fromCheckpointId is optional — absent means "from the earliest history
      // the server still retains".
      return (
        isRoomId(message.roomId) &&
        (message.fromCheckpointId === undefined ||
          isId(message.fromCheckpointId))
      )

    // Allow-list: an unrecognised type is rejected, never passed through.
    default:
      return false
  }
}
//#endregion
