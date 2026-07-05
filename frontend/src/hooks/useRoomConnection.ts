//#region Imports
import { useCallback, useMemo, useState, type RefObject } from "react"

import useWebSocket from "@/hooks/useWebSocket"
import { useSessionStorage } from "@/hooks/useSessionStorage"

import {
  applyDrawInstructionToCanvas,
  applySnapshotToCanvas,
} from "@shared/utils/handleDrawProtocol"

import type { DrawInstruction } from "@shared/types/drawProtocol"
import type {
  ClientSocketMessage,
  ServerSocketMessage,
} from "@shared/types/socketProtocol"
import type { WebSocketOptions } from "@/hooks/useWebSocket"
import type { ClientSocket } from "@/types/ClientSocket"
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
        case "presence":
          setActiveUsers(message.activeUsers)
          break

        case "draw":
          if (message.roomId === roomId && canvasRef.current) {
            applyDrawInstructionToCanvas(canvasRef.current, message.action)
          }
          break

        case "canvas_snapshot":
          if (message.roomId === roomId && canvasRef.current) {
            applySnapshotToCanvas(canvasRef.current, message.data)
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

  const sendDrawInstruction = useCallback(
    (action: DrawInstruction) => {
      const message: ClientSocketMessage = {
        type: "draw",
        roomId,
        action,
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
    [close, roomId, setRoomId],
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
