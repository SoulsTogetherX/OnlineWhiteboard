//#region Imports
import { useCallback, useEffect, useRef } from "react"

import type { ClientSocket } from "@/types/ClientSocket"
//#endregion

//#region Type Defs
type MaybeRefOrGetter<T> = T | React.RefObject<T> | (() => T)

export type WebSocketURL = string | URL | undefined
export type WebSocketStatus = "OPENED" | "CONNECTING" | "CLOSED"
export type WebSocketMessage = string | ArrayBuffer | Blob
export type WebSocketPayload = WebSocketMessage | Record<string, unknown>

export type WebSocketResult = {
  status: React.RefObject<WebSocketStatus>
  data: React.RefObject<any>
  send: (data: any) => boolean
  open: () => void
  close: () => void
  ws: React.RefObject<ClientSocket | null>
}

export type WebSocketOptions = {
  onConnected?: (ws: ClientSocket) => void
  onDisconnected?: (ws: ClientSocket, event: CloseEvent) => void
  onError?: (ws: ClientSocket, event: Event) => void
  onMessage?: (ws: ClientSocket, event: MessageEvent) => void
  immediate?: boolean
  autoConnect?: boolean
  autoClose?: boolean
  autoReconnect?:
    | boolean
    | {
        retries?: number | ((retried: number) => boolean)
        delay?: number | ((retries: number) => number)
        onFailed?: () => void
      }
  heartbeat?:
    | boolean
    | {
        message?: MaybeRefOrGetter<WebSocketPayload>
        responseMessage?: MaybeRefOrGetter<WebSocketMessage>
        scheduler?: (foo: () => void) => number
        pongTimeout?: number
      }
}
//#endregion

//#region Helper Methods
function isReactRef(value: any): value is React.RefObject<any> {
  return value !== null && typeof value === "object" && "current" in value
}

function resolveMaybeRef<T>(value: MaybeRefOrGetter<T>): T {
  if (isReactRef(value)) {
    return value.current
  }
  if (typeof value === "function") {
    return (value as () => T)()
  }
  return value
}

function toWebSocketUrl(url: WebSocketURL, roomId: string): string | undefined {
  if (!url) {
    return undefined
  }

  const rawUrl = url.toString()
  const resolved =
    rawUrl.startsWith("ws://") || rawUrl.startsWith("wss://")
      ? new URL(rawUrl)
      : new URL(rawUrl, window.location.href)

  if (resolved.protocol === "http:") {
    resolved.protocol = "ws:"
  } else if (resolved.protocol === "https:") {
    resolved.protocol = "wss:"
  }

  resolved.searchParams.set("roomId", roomId)
  return resolved.toString()
}

function serializeSocketPayload(payload: any): WebSocketMessage {
  if (typeof payload === "object" && payload !== null) {
    return JSON.stringify(payload)
  }
  return payload
}

function clearTimer(timer: React.MutableRefObject<number | null>): void {
  if (timer.current === null) {
    return
  }

  window.clearTimeout(timer.current)
  window.clearInterval(timer.current)
  timer.current = null
}
//#endregion

//#region Hook Def
export default function useWebSocket(
  socketUrl: MaybeRefOrGetter<WebSocketURL>,
  roomId: string,
  options?: WebSocketOptions,
): WebSocketResult {
  const {
    onConnected,
    onDisconnected,
    onError,
    onMessage,
    immediate = true,
    autoConnect = false,
    autoClose = true,
    autoReconnect = false,
    heartbeat = false,
  } = options ?? {}

  const reconnectOptions =
    typeof autoReconnect === "boolean" ? {} : autoReconnect
  const heartbeatOptions = typeof heartbeat === "boolean" ? {} : heartbeat

  const status = useRef<WebSocketStatus>("CLOSED")
  const data = useRef<any>(undefined)
  const ws = useRef<ClientSocket | null>(null)

  const manualClose = useRef(false)
  const retried = useRef(0)
  const openRef = useRef<() => void>(() => {})
  const reconnectTimer = useRef<number | null>(null)
  const heartbeatTimer = useRef<number | null>(null)
  const pongTimer = useRef<number | null>(null)

  const resolveUrl = useCallback((): WebSocketURL => {
    return resolveMaybeRef(socketUrl)
  }, [socketUrl])

  const send = useCallback((payload: any): boolean => {
    const socket = ws.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false

    try {
      socket.send(serializeSocketPayload(payload))
      return true
    } catch (error) {
      console.error("Failed to serialize or send data:", error)
      return false
    }
  }, [])

  const clearHeartbeat = useCallback((): void => {
    clearTimer(heartbeatTimer)
    clearTimer(pongTimer)
  }, [])

  const isHeartbeatResponse = useCallback(
    (event: MessageEvent): boolean => {
      const expected = heartbeatOptions.responseMessage ?? "pong"
      const expectedValue = resolveMaybeRef(expected)

      if (event.data === expectedValue) {
        return true
      }

      if (typeof event.data !== "string") {
        return false
      }

      try {
        const parsed = JSON.parse(event.data)
        return parsed.type === expectedValue || parsed.type === "pong"
      } catch {
        return false
      }
    },
    [heartbeatOptions],
  )

  const startHeartbeat = useCallback((): void => {
    if (!heartbeat) {
      return
    }

    clearHeartbeat()

    const heartbeatMessage = heartbeatOptions.message ?? { type: "ping" }
    const pongTimeout = heartbeatOptions.pongTimeout ?? 5_000

    const beat = () => {
      const resolvedMessage = resolveMaybeRef(heartbeatMessage)
      const payload =
        typeof resolvedMessage === "object" && resolvedMessage !== null
          ? { ...resolvedMessage, sentAt: Date.now() }
          : resolvedMessage

      if (!send(payload)) {
        return
      }

      clearTimer(pongTimer)
      pongTimer.current = window.setTimeout(() => {
        // Closing triggers the normal reconnect path. Code 4000 is app-owned.
        ws.current?.close(4000, "Heartbeat timed out")
      }, pongTimeout)
    }

    if (heartbeatOptions.scheduler) {
      heartbeatTimer.current = heartbeatOptions.scheduler(beat)
    } else {
      heartbeatTimer.current = window.setInterval(beat, 10_000)
    }

    beat()
  }, [clearHeartbeat, heartbeat, heartbeatOptions, send])

  const canReconnect = useCallback(
    (nextRetry: number): boolean => {
      if (!autoReconnect || manualClose.current) {
        return false
      }

      const retries = reconnectOptions.retries ?? 10
      return typeof retries === "function"
        ? retries(nextRetry)
        : nextRetry <= retries
    },
    [autoReconnect, reconnectOptions],
  )

  const getReconnectDelay = useCallback(
    (nextRetry: number): number => {
      const delay =
        reconnectOptions.delay ??
        ((count: number) => Math.min(count * 1000, 5000))
      return typeof delay === "function" ? delay(nextRetry) : delay
    },
    [reconnectOptions],
  )

  const scheduleReconnect = useCallback((): void => {
    const nextRetry = retried.current + 1
    if (!canReconnect(nextRetry)) {
      reconnectOptions.onFailed?.()
      return
    }

    retried.current = nextRetry
    clearTimer(reconnectTimer)
    reconnectTimer.current = window.setTimeout(() => {
      openRef.current()
    }, getReconnectDelay(nextRetry))
  }, [canReconnect, getReconnectDelay, reconnectOptions])

  const open = useCallback((): void => {
    const fullUrl = toWebSocketUrl(resolveUrl(), roomId)
    if (!fullUrl) return

    if (
      ws.current &&
      (ws.current.readyState === WebSocket.CONNECTING ||
        ws.current.readyState === WebSocket.OPEN)
    ) {
      return
    }

    manualClose.current = false
    status.current = "CONNECTING"

    const socket = new WebSocket(fullUrl) as ClientSocket
    ws.current = socket

    socket.addEventListener("open", () => {
      status.current = "OPENED"
      retried.current = 0
      clearTimer(reconnectTimer)
      startHeartbeat()
      onConnected?.(socket)
    })

    socket.addEventListener("close", (event: CloseEvent) => {
      status.current = "CLOSED"
      clearHeartbeat()
      onDisconnected?.(socket, event)
      if (ws.current === socket) {
        ws.current = null
      }
      scheduleReconnect()
    })

    socket.addEventListener("error", (event: Event) => {
      onError?.(socket, event)
    })

    socket.addEventListener("message", (event: MessageEvent) => {
      data.current = event.data
      if (isHeartbeatResponse(event)) {
        clearTimer(pongTimer)
      }
      onMessage?.(socket, event)
    })
  }, [
    clearHeartbeat,
    isHeartbeatResponse,
    onConnected,
    onDisconnected,
    onError,
    onMessage,
    resolveUrl,
    roomId,
    scheduleReconnect,
    startHeartbeat,
  ])

  const close = useCallback((): void => {
    manualClose.current = true
    clearTimer(reconnectTimer)
    clearHeartbeat()
    ws.current?.close()
  }, [clearHeartbeat])

  openRef.current = open

  useEffect(() => {
    if (!autoClose) {
      return
    }

    const handleBeforeUnload = () => {
      manualClose.current = true
      ws.current?.close()
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [autoClose])

  useEffect(() => {
    if (!immediate && !autoConnect) {
      return
    }

    open()

    return () => {
      if (autoClose) {
        close()
      }
    }
  }, [autoClose, autoConnect, close, immediate, open])

  return {
    status,
    data,
    send,
    open,
    close,
    ws,
  }
}
//#endregion
