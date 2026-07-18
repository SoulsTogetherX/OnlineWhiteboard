//#region Imports
import { useCallback, useEffect, useState } from "react"

import type { RoomRole } from "@shared/types/identity"
//#endregion

//#region Types
export interface UserRoom {
  roomId: string
  title: string | null
  role: RoomRole
  // Serialised as an ISO string over JSON.
  updatedAt: string
}
//#endregion

//#region Hook
// Loads the logged-in user's rooms when the dashboard opens. Same fetch-returns-
// data + apply-in-.then shape as useRoomMembers, so no setState runs
// synchronously inside the effect.
export default function useMyRooms(isOpen: boolean): {
  rooms: UserRoom[]
  error: string | null
} {
  const [rooms, setRooms] = useState<UserRoom[]>([])
  const [error, setError] = useState<string | null>(null)

  const fetchRooms = useCallback(async (): Promise<
    { rooms: UserRoom[] } | { error: string }
  > => {
    try {
      const res = await fetch("/api/rooms")
      if (!res.ok) {
        return {
          error:
            res.status === 401
              ? "Log in to see your rooms."
              : "Could not load your rooms.",
        }
      }
      const data = (await res.json()) as { rooms: UserRoom[] }
      return { rooms: data.rooms }
    } catch {
      return { error: "Could not load your rooms." }
    }
  }, [])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    let cancelled = false
    fetchRooms().then((result) => {
      if (cancelled) {
        return
      }
      if ("error" in result) {
        setRooms([])
        setError(result.error)
      } else {
        setRooms(result.rooms)
        setError(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, fetchRooms])

  return { rooms, error }
}
//#endregion
