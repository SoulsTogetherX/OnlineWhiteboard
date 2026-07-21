//#region Imports
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react"

import useWebSocket from "@/hooks/useWebSocket"

import {
  applyDrawInstructionToCanvas,
  applySnapshotToCanvas,
} from "@shared/utils/handleCanvasProtocol"
import { decodeBinaryFrame } from "@shared/utils/binaryFrame"
import { encodePatchDrawFrame } from "@shared/utils/patchCodec"
import { decompressSnapshotPayload } from "@/utils/snapshotCompression"
import { clearHolds, latestExpiry, overlayHolds } from "@/utils/localHold"

import type { DrawInstruction } from "@shared/types/drawProtocol"
import type {
  CheckpointInfo,
  ClientSocketMessage,
  EditorRequest,
  PlaybackStep,
  ServerSocketMessage,
} from "@shared/types/socketProtocol"
import type { Participant, RoomRole } from "@shared/types/identity"
import type { Vec } from "@shared/types/primitive"
import type { WebSocketOptions } from "@/hooks/useWebSocket"
import {
  canvasDimsOf,
  getCanvasState,
  updateCanvas,
} from "@shared/utils/helperProtocolMethods"
import { DEFAULT_CANVAS_DIMS } from "@shared/constants/canvas"
//#endregion

//#region Constants
// Where the shell remembers the last room you were in, so the lobby can offer it
// back. Exported because the lobby, not this hook, is now what persists it.
export const ROOM_ID_STORAGE_KEY = "online-whiteboard-room-id"
export const DEFAULT_ROOM_ID = "testRoom"
//#endregion

//#region Type Def
// The room's permission state, mirrored from the server. Every control that can
// be greyed out reads from here, using the SAME shared predicates the server
// enforces with — so the UI cannot promise something the server will reject.
export interface RoomSettings {
  openEditing: boolean
  hasOwner: boolean
}

// The payload to animate a history playback.
export interface PlaybackData {
  base: string
  baseRevision: number
  // The dimensions the base and steps are in, so the viewer renders a resized
  // room's history at the right size.
  width: number
  height: number
  steps: PlaybackStep[]
}

export interface UseRoomConnectionResult {
  roomId: string
  participants: Participant[]
  self: Participant | null
  socketLabel: string
  loadRoom: (nextRoomId: string) => void
  sendDrawInstruction: (action: DrawInstruction) => void
  sendCursor: (pos: Vec | null) => void
  // Room permissions and ownership.
  settings: RoomSettings
  clearCanvas: () => void
  claimOwnership: () => void
  releaseOwnership: () => void
  setOpenEditing: (enabled: boolean) => void
  // Owner-only: resize the room's canvas. The new size comes back as a snapshot.
  resize: (width: number, height: number) => void
  // The room's current canvas dimensions, updated from every applied snapshot.
  // The resize control reads these to show and pre-fill the current size.
  canvasDims: { width: number; height: number }
  // Set whenever an applied snapshot CHANGED the canvas dimensions (a resize),
  // carrying the old and new dims. The app re-anchors anything keyed to the old
  // size (the undo/redo stacks) to the new one. Null until the first resize.
  canvasResize: {
    from: { width: number; height: number }
    to: { width: number; height: number }
  } | null
  // Editor access requests. `editorRequests` is only ever populated for an
  // owner — the server sends the list to nobody else.
  editorRequests: EditorRequest[]
  requestEditor: () => void
  respondEditor: (userId: string, approve: boolean) => void
  setMemberRole: (userId: string, role: RoomRole) => void
  // Checkpoints (saved versions) + history playback.
  checkpoints: CheckpointInfo[]
  createCheckpoint: (name: string) => void
  restoreCheckpoint: (checkpointId: string) => void
  deleteCheckpoint: (checkpointId: string) => void
  requestPlayback: (fromCheckpointId?: string) => void
  // The data for the current playback (base canvas + steps to animate), or null.
  playback: PlaybackData | null
  clearPlayback: () => void
  // Live cursor positions keyed by connectionId. A REF, not state: cursor moves
  // arrive many times a second and must not trigger a React render each time —
  // the overlay reads this directly in a requestAnimationFrame loop.
  cursorsRef: RefObject<Map<string, Vec>>
  // The connectionIds that currently have a cursor. State (so the overlay knows
  // which cursor nodes to render), but only changes when a cursor appears or
  // disappears — never on movement.
  cursorIds: string[]
}
//#endregion

//#region Hook Def
export default function useRoomConnection(
  canvasRef: RefObject<HTMLCanvasElement>,
  closeRoom: () => void,
  // The logged-in user's id, or null for a guest. Changing it forces a socket
  // reconnect so the server re-resolves this connection's identity from the new
  // session cookie (see reconnectKey in useWebSocket).
  identityKey: string | null,
  // The room to open on mount. The hook no longer persists this itself: the app
  // shell decides which room (if any) is being entered, because there is now a
  // lobby in front of the board and "which room am I in" is the thing that tells
  // those two views apart. Switching rooms from the Room tab still happens in
  // here, via loadRoom.
  initialRoomId: string,
): UseRoomConnectionResult {
  const [roomId, setRoomId] = useState<string>(initialRoomId)

  const [participants, setParticipants] = useState<Participant[]>([])
  const [self, setSelf] = useState<Participant | null>(null)
  const [socketLabel, setSocketLabel] = useState<string>("Connecting")
  const [settings, setSettings] = useState<RoomSettings>({
    // Optimistic defaults matching the server's column default, replaced by the
    // real values in the very first "ready" message. Defaulting to open avoids a
    // flash of disabled tools on every join.
    openEditing: true,
    hasOwner: false,
  })
  const [editorRequests, setEditorRequests] = useState<EditorRequest[]>([])
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([])
  const [playback, setPlayback] = useState<PlaybackData | null>(null)

  // Cursor positions live in a ref (mutated on every move, no render); cursorIds
  // is the render-driving set that only changes on appear/disappear.
  const cursorsRef = useRef<Map<string, Vec>>(new Map())
  const [cursorIds, setCursorIds] = useState<string[]>([])

  // Populated once useWebSocket returns below. handleSocketMessage needs to
  // be able to send a "resync" request, but it's itself a dependency of the
  // options useWebSocket is constructed with — a ref sidesteps the cycle.
  const sendRef = useRef<(message: ClientSocketMessage) => boolean>(() => false)
  const lastRevision = useRef<number>(0)

  // The dimensions of the last snapshot we applied. Null until the first
  // snapshot; a later snapshot with different dims is a resize (see the
  // canvas_snapshot handler). `canvasResize` carries the old and new dims of the
  // most recent resize so the app can re-anchor anything keyed to the old size
  // (the undo/redo stacks). A fresh object each time triggers the app's effect.
  const knownDims = useRef<{ width: number; height: number } | null>(null)
  const [canvasResize, setCanvasResize] = useState<{
    from: { width: number; height: number }
    to: { width: number; height: number }
  } | null>(null)
  // The current room size, mirrored as state so the resize control re-renders
  // when a snapshot changes it. Starts at the creation default and is corrected
  // by the first snapshot on join.
  const [canvasDims, setCanvasDims] = useState<{
    width: number
    height: number
  }>(DEFAULT_CANVAS_DIMS)

  // Serialises everything that touches the canvas, in arrival order.
  //
  // Needed because inflating a compressed snapshot is asynchronous — the browser
  // has no synchronous inflate — so a snapshot can no longer be applied in the
  // turn it arrives. Without this, a draw landing mid-inflate would apply to the
  // current buffer and then be wiped by a snapshot describing an OLDER revision,
  // and lastRevision would go backwards. The client would recover on the next
  // revision_check, but only after up to 10 seconds of showing a canvas missing
  // a stroke everyone else could see.
  //
  // A promise chain rather than a "pending draws" queue because it needs no
  // bookkeeping to be correct: whatever order messages arrived in is the order
  // they are applied, whether or not any of them needed to await. Draws pay one
  // microtask, which is nothing next to the network hop they just made.
  const canvasWork = useRef<Promise<void>>(Promise.resolve())
  const enqueueCanvasWork = useCallback((work: () => void | Promise<void>) => {
    canvasWork.current = canvasWork.current.then(work).catch(() => {
      // One failed frame must not poison the chain for every later message.
    })
  }, [])

  // The one timer that reveals converged pixels when a local hold expires with no
  // further traffic to trigger a repaint (see @/utils/localHold). Held here, not
  // in localHold, so the DOM-free overlay logic stays unit-testable.
  const holdExpiryTimer = useRef<number | null>(null)

  // Blits the authoritative buffer with any still-live local holds composited on
  // top. The no-hold path (overlayHolds returns null) is the common case and
  // pays no copy — it is exactly updateCanvas. overlayHolds prunes expired holds
  // as it reads them, so a paint after expiry naturally reveals the converged
  // pixel underneath.
  const paintHeld = useCallback((canvas: HTMLCanvasElement) => {
    const dims = canvasDimsOf(canvas)
    const canvasState = getCanvasState(canvas, dims)
    if (canvasState === null) {
      return
    }
    const overlay = overlayHolds(canvasState.imageData.data, Date.now())
    if (overlay === null) {
      updateCanvas(canvas, dims)
    } else {
      canvasState.ctx.putImageData(
        new ImageData(overlay, canvas.width, canvas.height),
        0,
        0,
      )
    }
  }, [])

  // Paints, then arms a SINGLE timer for the last hold's expiry so the converged
  // pixel appears on time even if no further message arrives. No recursion: the
  // timer just repaints once. Every remote instruction that contests a held
  // pixel comes back through here and re-arms the timer for the current latest
  // expiry, so one timer always covers every outstanding hold.
  const repaintWithHolds = useCallback(
    (canvas: HTMLCanvasElement) => {
      paintHeld(canvas)

      if (holdExpiryTimer.current !== null) {
        window.clearTimeout(holdExpiryTimer.current)
        holdExpiryTimer.current = null
      }
      const expiry = latestExpiry()
      if (expiry !== null) {
        holdExpiryTimer.current = window.setTimeout(() => {
          holdExpiryTimer.current = null
          const current = canvasRef.current
          if (current) {
            paintHeld(current)
          }
        }, Math.max(0, expiry - Date.now()))
      }
    },
    [canvasRef, paintHeld],
  )

  const handleSocketMessage = useCallback(
    (_socket: WebSocket, event: MessageEvent) => {
      let message: ServerSocketMessage
      // Bulk bytes riding along with the message, for the binary frames that
      // carry them (today: canvas_snapshot's pixels). Null for text messages.
      let payload: Uint8Array | null = null

      if (event.data instanceof ArrayBuffer) {
        // A binary frame is a JSON header plus a payload — so it dispatches
        // through the SAME switch below, with the pixels handed over on the
        // side. See shared/utils/binaryFrame.ts.
        const frame = decodeBinaryFrame(event.data)
        if (frame === null) {
          return
        }
        message = frame.header as ServerSocketMessage
        payload = frame.payload
      } else if (typeof event.data === "string") {
        try {
          message = JSON.parse(event.data) as ServerSocketMessage
        } catch {
          return
        }
      } else {
        return
      }

      switch (message.type) {
        case "ready":
          setSelf(message.self)
          setParticipants(message.participants)
          setSettings({
            openEditing: message.openEditing,
            hasOwner: message.hasOwner,
          })
          lastRevision.current = message.revision
          break

        case "room_settings":
          if (message.roomId === roomId) {
            setSettings({
              openEditing: message.openEditing,
              hasOwner: message.hasOwner,
            })
          }
          break

        case "editor_requests":
          if (message.roomId === roomId) {
            setEditorRequests(message.requests)
          }
          break

        case "role_changed":
          // Only this connection's own identity. Everyone else's view of us
          // arrives through the presence broadcast instead.
          if (message.roomId === roomId) {
            setSelf(message.self)
          }
          break

        case "presence": {
          setParticipants(message.participants)
          // Drop cursors for anyone who has left, so a stale cursor doesn't
          // linger after its owner disconnects.
          const present = new Set(
            message.participants.map((p) => p.connectionId),
          )
          for (const id of cursorsRef.current.keys()) {
            if (!present.has(id)) {
              cursorsRef.current.delete(id)
            }
          }
          setCursorIds((ids) => ids.filter((id) => present.has(id)))
          break
        }

        case "cursor": {
          const { connectionId, pos } = message
          if (pos === null) {
            // Pointer left the canvas — remove the cursor.
            if (cursorsRef.current.delete(connectionId)) {
              setCursorIds((ids) => ids.filter((id) => id !== connectionId))
            }
          } else {
            const isNew = !cursorsRef.current.has(connectionId)
            cursorsRef.current.set(connectionId, pos)
            // Only touch state when a NEW cursor appears; plain moves stay in the
            // ref and never re-render.
            if (isNew) {
              setCursorIds((ids) => [...ids, connectionId])
            }
          }
          break
        }

        case "draw": {
          if (message.roomId !== roomId) {
            break
          }
          const drawMessage = message
          enqueueCanvasWork(() => {
            const canvas = canvasRef.current
            if (!canvas) {
              return
            }
            const dims = canvasDimsOf(canvas)
            const canvasState = getCanvasState(canvas, dims)
            if (canvasState === null) {
              return
            }
            // "replay": the server has already decided what this instruction
            // applies. Re-running a patch's compare-and-swap here would let a
            // client skip a write the server made, and silently diverge.
            applyDrawInstructionToCanvas(
              canvasState.imageData,
              drawMessage.instruction,
              dims,
              "replay",
            )
            // repaintWithHolds, not updateCanvas: if this remote instruction
            // overwrote a pixel this client painted in the last 100 ms, the local
            // colour stays SHOWN (never re-applied to the buffer) until it
            // expires. The buffer above already holds the server's truth, so
            // convergence is untouched.
            repaintWithHolds(canvas)
            lastRevision.current = drawMessage.revision
          })
          break
        }

        case "canvas_snapshot": {
          // `payload` is null if this arrived as text, which the server never
          // sends — dropping it is right either way, since a snapshot header
          // with no pixels describes a canvas we do not have.
          if (message.roomId !== roomId || !payload) {
            break
          }
          const snapshotMessage = message
          const compressed = payload
          enqueueCanvasWork(async () => {
            const pixels = await decompressSnapshotPayload(
              compressed,
              snapshotMessage.compression,
            )
            const canvas = canvasRef.current
            // A payload that would not inflate is dropped, leaving the previous
            // canvas up. The next revision_check notices we are behind and asks
            // for a fresh snapshot.
            if (pixels === null || !canvas) {
              return
            }
            // A snapshot whose dimensions differ from the last one we knew is a
            // RESIZE. Everything keyed to the old size is now stale: the live
            // holds (cleared here — they are display-only and would expire in
            // 100 ms anyway) and — signalled to the app via canvasResize — the
            // undo/redo stacks, which the app RE-ANCHORS to the new size rather
            // than discarding. `knownDims` starts null so the FIRST snapshot on
            // join is not treated as a resize.
            const prevDims = knownDims.current
            const nextDims = {
              width: snapshotMessage.width,
              height: snapshotMessage.height,
            }
            if (
              prevDims !== null &&
              (prevDims.width !== nextDims.width ||
                prevDims.height !== nextDims.height)
            ) {
              clearHolds()
              setCanvasResize({ from: prevDims, to: nextDims })
            }
            knownDims.current = nextDims
            // Mirror the size to state so the resize control reflects it. Guard
            // on the values (every snapshot is a fresh object, and a same-size
            // resync arrives routinely) so an unchanged size triggers no render.
            setCanvasDims((prev) =>
              prev.width === nextDims.width && prev.height === nextDims.height
                ? prev
                : nextDims,
            )

            // The snapshot header carries the room's dimensions; sizing the
            // element to them here is what makes a live resize take effect on the
            // client.
            applySnapshotToCanvas(canvas, pixels, nextDims)
            // A snapshot replaces the whole buffer, so re-composite any live
            // holds on top — otherwise a resync arriving right after a local
            // stroke would blink it away before its 100 ms were up.
            repaintWithHolds(canvas)
            lastRevision.current = snapshotMessage.revision
          })
          break
        }

        case "revision_check":
          // Server's revision is strictly ahead of the last one we've
          // actually applied — we missed a "draw" broadcast somewhere.
          // Ask for a fresh snapshot, targeted at just this connection,
          // rather than everyone in the room paying for a periodic resync
          // they didn't need.
          if (
            message.roomId === roomId &&
            message.revision > lastRevision.current
          ) {
            sendRef.current({ type: "resync", roomId })
          }
          break


        case "checkpoints":
          if (message.roomId === roomId) {
            setCheckpoints(message.checkpoints)
          }
          break

        case "playback":
          if (message.roomId === roomId) {
            setPlayback({
              base: message.base,
              baseRevision: message.baseRevision,
              width: message.width,
              height: message.height,
              steps: message.steps,
            })
          }
          break

        case "error":
          console.error(message.message)
          break
      }
    },
    [canvasRef, roomId, enqueueCanvasWork, repaintWithHolds],
  )

  const socketOptions = useMemo<WebSocketOptions>(
    () => ({
      heartbeat: {
        message: { type: "ping" },
        responseMessage: "pong",
        pongTimeout: 5_000,
      },
      autoReconnect: {
        retries: 10,
        delay: (retry) => Math.min(retry * 750, 5_000),
        onFailed: () => setSocketLabel("Offline"),
      },
      onConnected: () => setSocketLabel("Connected"),
      onDisconnected: () => setSocketLabel("Reconnecting"),
      onError: () => setSocketLabel("Connection error"),
      onMessage: handleSocketMessage,
      // Reconnect when the login state changes so identity is re-resolved.
      reconnectKey: identityKey ?? "guest",
    }),
    [handleSocketMessage, identityKey],
  )

  const { send, close } = useWebSocket("/ws", roomId, socketOptions)

  // Assigned in an effect, not during render. Writing to a ref during render is
  // a side effect: under concurrent rendering React may render a component
  // without committing it, which would leave sendRef pointing at a `send` from
  // a render that never happened. Committing it in an effect keeps the ref in
  // step with what's actually on screen.
  //
  // Safe despite running after the first paint: the only reader is the
  // "revision_check" branch, and the server sends that on a 10s interval — long
  // after mount.
  useEffect(() => {
    sendRef.current = send
  }, [send])

  // Holds belong to the CURRENT room's canvas. When the room changes (or the
  // hook unmounts), forget them and cancel the pending reveal, so a stroke in
  // flight can never composite onto the next room's board.
  useEffect(() => {
    return () => {
      clearHolds()
      // Forget the last room's size so the next room's first snapshot is not
      // mistaken for a resize.
      knownDims.current = null
      if (holdExpiryTimer.current !== null) {
        window.clearTimeout(holdExpiryTimer.current)
        holdExpiryTimer.current = null
      }
    }
  }, [roomId])

  const sendDrawInstruction = useCallback(
    (instruction: DrawInstruction) => {
      // Patches go out as a binary frame — an undo of a large fill is thousands
      // of entries, ~1.4 MB as JSON but ~12 bytes each packed. Every other tool
      // is a handful of numbers, so it stays JSON where it is easiest to read on
      // the wire. Both arrive at the server as an identical "draw" message.
      if (instruction.type === "patch") {
        send(encodePatchDrawFrame(roomId, instruction))
        return
      }
      const message: ClientSocketMessage = {
        type: "draw",
        roomId,
        instruction,
      }
      send(message)
    },
    [roomId, send],
  )

  const sendCursor = useCallback(
    (pos: Vec | null) => {
      send({ type: "cursor", roomId, pos })
    },
    [roomId, send],
  )

  // Owner-only actions. Each is sent optimistically and the server is the
  // authority: if this connection is not the owner the message is rejected and
  // an "error" comes back, so a stale client cannot act on a permission it lost.
  const clearCanvas = useCallback(() => {
    send({ type: "room_action", roomId, action: "clear" })
  }, [roomId, send])

  const claimOwnership = useCallback(() => {
    send({ type: "claim_ownership", roomId })
  }, [roomId, send])

  // The UI shows exactly one of claim/release depending on whether this
  // connection is the owner, so these are two messages rather than one toggle —
  // a toggle would be ambiguous if the client's view of ownership were stale.
  const releaseOwnership = useCallback(() => {
    send({ type: "release_ownership", roomId })
  }, [roomId, send])

  const setOpenEditing = useCallback(
    (enabled: boolean) => {
      // No optimistic local update: the authoritative value comes back in a
      // room_settings broadcast. Setting it locally first would briefly show
      // permissions the server had not agreed to.
      send({ type: "set_open_editing", roomId, enabled })
    },
    [roomId, send],
  )

  const resize = useCallback(
    (width: number, height: number) => {
      // Owner-only and validated server-side; the new size arrives back as a
      // fresh snapshot, which is what actually resizes the local canvas.
      send({ type: "resize", roomId, width, height })
    },
    [roomId, send],
  )

  const requestEditor = useCallback(() => {
    send({ type: "request_editor", roomId })
  }, [roomId, send])

  const respondEditor = useCallback(
    (userId: string, approve: boolean) => {
      send({ type: "respond_editor", roomId, userId, approve })
    },
    [roomId, send],
  )

  const setMemberRole = useCallback(
    (userId: string, role: RoomRole) => {
      send({ type: "set_member_role", roomId, userId, role })
    },
    [roomId, send],
  )

  const createCheckpoint = useCallback(
    (name: string) => {
      send({ type: "create_checkpoint", roomId, name })
    },
    [roomId, send],
  )
  const restoreCheckpoint = useCallback(
    (checkpointId: string) => {
      send({ type: "restore_checkpoint", roomId, checkpointId })
    },
    [roomId, send],
  )
  const deleteCheckpoint = useCallback(
    (checkpointId: string) => {
      send({ type: "delete_checkpoint", roomId, checkpointId })
    },
    [roomId, send],
  )
  const requestPlayback = useCallback(
    (fromCheckpointId?: string) => {
      send({ type: "request_playback", roomId, fromCheckpointId })
    },
    [roomId, send],
  )
  const clearPlayback = useCallback(() => setPlayback(null), [])

  const loadRoom = useCallback(
    (nextRoomId: string) => {
      const trimmedRoomId = nextRoomId.trim()

      if (!trimmedRoomId || trimmedRoomId === roomId) {
        closeRoom()
        return
      }

      close()
      setRoomId(trimmedRoomId)
      setParticipants([])
      setSelf(null)
      // Permissions are per-room, so they must not survive a room change —
      // carrying an owner's settings into the next room would briefly show
      // controls this connection has no right to there.
      setSettings({ openEditing: true, hasOwner: false })
      setEditorRequests([])
      setCheckpoints([])
      setPlayback(null)
      // Back to the creation default until the new room's first snapshot lands,
      // so the resize control never shows the previous room's size.
      setCanvasDims(DEFAULT_CANVAS_DIMS)
      cursorsRef.current.clear()
      setCursorIds([])
      setSocketLabel("Connecting")
      closeRoom()
    },
    [close, roomId, setRoomId, closeRoom],
  )

  return {
    roomId,
    participants,
    self,
    socketLabel,
    loadRoom,
    sendDrawInstruction,
    sendCursor,
    settings,
    clearCanvas,
    claimOwnership,
    releaseOwnership,
    setOpenEditing,
    resize,
    canvasDims,
    canvasResize,
    editorRequests,
    requestEditor,
    respondEditor,
    setMemberRole,
    checkpoints,
    createCheckpoint,
    restoreCheckpoint,
    deleteCheckpoint,
    requestPlayback,
    playback,
    clearPlayback,
    cursorsRef,
    cursorIds,
  }
}

//#endregion
