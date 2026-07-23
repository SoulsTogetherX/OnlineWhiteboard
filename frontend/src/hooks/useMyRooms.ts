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
  leaveRooms: (roomIds: string[]) => Promise<void>
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

  // Drops the caller's membership of each room, which is what removes it from
  // this list. The canvas itself is untouched — see the server's leaveRoom.
  //
  // Sequential rather than Promise.all. Each response carries the authoritative
  // list as of that removal, so awaiting them in order means the LAST response
  // is the true final state. Fired in parallel the responses can land out of
  // order, and the list would settle on whichever finished last — possibly a
  // snapshot taken before some of the other removals, showing rooms back again
  // that were just deleted. These are a handful of requests behind one click, so
  // the round trips cost nothing worth that race.
  const leaveRooms = useCallback(async (roomIds: string[]): Promise<void> => {
    let latest: UserRoom[] | null = null
    let failed = false

    for (const roomId of roomIds) {
      try {
        const res = await fetch(
          `/api/rooms/${encodeURIComponent(roomId)}/membership`,
          { method: "DELETE" },
        )
        if (!res.ok) {
          failed = true
          continue
        }
        latest = ((await res.json()) as { rooms: UserRoom[] }).rooms
      } catch {
        failed = true
      }
    }

    // Apply whatever the server last confirmed, even on a partial failure: the
    // rooms that DID go should leave the list, and the message says the rest
    // may not have.
    if (latest) {
      setRooms(latest)
    }
    setError(failed ? "Some rooms could not be removed. Reopen to check." : null)
  }, [])

  return { rooms, error, leaveRooms }
}
//#endregion
