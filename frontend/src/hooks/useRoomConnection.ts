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
  ClientSocketMessage,
  ServerSocketMessage,
} from "@shared/types/socketProtocol"
import type { WebSocketOptions } from "@/hooks/useWebSocket"
import type { ClientSocket } from "@/types/ClientSocket"
import { getCanvasState, updateCanvas } from "@shared/utils/helperProtocallMethods"
//#endregion

//#region Constants
const ROOM_ID_STORAGE_KEY = "online-whiteboard-room-id"
const DEFAULT_ROOM_ID = "testRoom"
//#endregion

//#region Type Def
export interface UseRoomConnectionResult {
  roomId: string
  setRoomId: (val: string) => void
  activeUsers: number
  socketLabel: string
  loadRoom: (nextRoomId: string) => void
  sendDrawInstruction: (action: DrawInstruction) => void
}
//#endregion

//#region Hook Def
export default function useRoomConnection(
  canvasRef: RefObject<HTMLCanvasElement>,
  closeRoom: () => void,
): UseRoomConnectionResult {
  const [roomId, setRoomId] = useSessionStorage<string>(
    ROOM_ID_STORAGE_KEY,
    DEFAULT_ROOM_ID,
  )

  const [activeUsers, setActiveUsers] = useState<number>(1)
  const [socketLabel, setSocketLabel] = useState<string>("Connecting")

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
          setActiveUsers(message.activeUsers)
          lastRevision.current = message.revision
          break

        case "presence":
          setActiveUsers(message.activeUsers)
          break

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
    }),
    [handleSocketMessage],
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

  const loadRoom = useCallback(
    (nextRoomId: string) => {
      const trimmedRoomId = nextRoomId.trim()

      if (!trimmedRoomId || trimmedRoomId === roomId) {
        closeRoom()
        return
      }

      close()
      setRoomId(trimmedRoomId)
      setActiveUsers(1)
      setSocketLabel("Connecting")
      closeRoom()
    },
    [close, roomId, setRoomId, closeRoom],
  )

  return {
    roomId,
    setRoomId,
    activeUsers,
    socketLabel,
    loadRoom,
    sendDrawInstruction,
  }
}

//#endregion
