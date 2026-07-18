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
import { useSessionStorage } from "@/hooks/useSessionStorage"

import {
  applyDrawInstructionToCanvas,
  applySnapshotToCanvas,
} from "@shared/utils/handleCanvasProtocol"

import type { DrawInstruction } from "@shared/types/drawProtocol"
import type {
  CheckpointInfo,
  ClientSocketMessage,
  PlaybackStep,
  RoomAction,
  ServerSocketMessage,
} from "@shared/types/socketProtocol"
import type { Participant } from "@shared/types/identity"
import type { Vec } from "@shared/types/primitive"
import type { WebSocketOptions } from "@/hooks/useWebSocket"
import type { ClientSocket } from "@/types/ClientSocket"
import { getCanvasState, updateCanvas } from "@shared/utils/helperProtocallMethods"
//#endregion

//#region Constants
const ROOM_ID_STORAGE_KEY = "online-whiteboard-room-id"
const DEFAULT_ROOM_ID = "testRoom"
//#endregion

//#region Type Def
// The vote prompt this client should show, mirrored from the server's
// vote_started/vote_update messages. Null when there's no vote to act on.
export interface ActiveVote {
  voteId: string
  action: RoomAction
  initiatorName: string
  voters: number
  approvals: number
  deadline: number
}

// The payload to animate a history playback.
export interface PlaybackData {
  base: string
  baseRevision: number
  steps: PlaybackStep[]
}

export interface UseRoomConnectionResult {
  roomId: string
  setRoomId: (val: string) => void
  participants: Participant[]
  self: Participant | null
  socketLabel: string
  loadRoom: (nextRoomId: string) => void
  sendDrawInstruction: (action: DrawInstruction) => void
  sendCursor: (pos: Vec | null) => void
  // Destructive-action voting.
  activeVote: ActiveVote | null
  requestClear: () => void
  castVote: (approve: boolean) => void
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
): UseRoomConnectionResult {
  const [roomId, setRoomId] = useSessionStorage<string>(
    ROOM_ID_STORAGE_KEY,
    DEFAULT_ROOM_ID,
  )

  const [participants, setParticipants] = useState<Participant[]>([])
  const [self, setSelf] = useState<Participant | null>(null)
  const [socketLabel, setSocketLabel] = useState<string>("Connecting")
  const [activeVote, setActiveVote] = useState<ActiveVote | null>(null)
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

  const handleSocketMessage = useCallback(
    (_socket: ClientSocket, event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return
      }

      let message: ServerSocketMessage

      try {
        message = JSON.parse(event.data) as ServerSocketMessage
      } catch {
        return
      }

      switch (message.type) {
        case "ready":
          setSelf(message.self)
          setParticipants(message.participants)
          lastRevision.current = message.revision
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

        case "draw":
          if (message.roomId === roomId && canvasRef.current) {
            const canvasState = getCanvasState(canvasRef.current)
            if (canvasState === null) {
              return
            }
            applyDrawInstructionToCanvas(
              canvasState.imageData,
              message.instruction,
            )
            updateCanvas(canvasRef.current)
            lastRevision.current = message.revision
          }
          break

        case "canvas_snapshot":
          if (message.roomId === roomId && canvasRef.current) {
            applySnapshotToCanvas(canvasRef.current, message.data)
            lastRevision.current = message.revision
          }
          break

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

        case "vote_started":
          if (message.roomId === roomId) {
            setActiveVote({
              voteId: message.voteId,
              action: message.action,
              initiatorName: message.initiatorName,
              voters: message.voters,
              approvals: message.approvals,
              deadline: message.deadline,
            })
          }
          break

        case "vote_update":
          // Update the running tally, but only for the vote we're showing.
          setActiveVote((current) =>
            current && current.voteId === message.voteId
              ? {
                  ...current,
                  voters: message.voters,
                  approvals: message.approvals,
                }
              : current,
          )
          break

        case "vote_resolved":
          // Dismiss the prompt whichever way it went; the canvas change (if
          // approved) arrives separately as a normal "draw".
          setActiveVote((current) =>
            current && current.voteId === message.voteId ? null : current,
          )
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
              steps: message.steps,
            })
          }
          break

        case "error":
          console.error(message.message)
          break
      }
    },
    [canvasRef, roomId],
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

  const sendDrawInstruction = useCallback(
    (instruction: DrawInstruction) => {
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

  const requestClear = useCallback(() => {
    send({ type: "request_action", roomId, action: "clear" })
  }, [roomId, send])

  const castVote = useCallback(
    (approve: boolean) => {
      setActiveVote((current) => {
        if (current) {
          send({ type: "vote", roomId, voteId: current.voteId, approve })
        }
        // Dismiss our own prompt immediately; the server confirms via
        // vote_resolved. Rejecting is final for us either way.
        return null
      })
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
      setActiveVote(null)
      setCheckpoints([])
      setPlayback(null)
      cursorsRef.current.clear()
      setCursorIds([])
      setSocketLabel("Connecting")
      closeRoom()
    },
    [close, roomId, setRoomId, closeRoom],
  )

  return {
    roomId,
    setRoomId,
    participants,
    self,
    socketLabel,
    loadRoom,
    sendDrawInstruction,
    sendCursor,
    activeVote,
    requestClear,
    castVote,
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
