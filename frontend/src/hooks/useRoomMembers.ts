//#region Imports
import { useCallback, useEffect, useState } from "react"

import type { RoomRole } from "@shared/types/identity"
//#endregion

//#region Types
export interface RoomMember {
  userId: string
  username: string
  color: string
  role: RoomRole
}

export interface UseRoomMembersResult {
  members: RoomMember[]
  // This user's own role in the room, or null if they aren't a member / not
  // logged in. Drives whether the management controls are shown.
  myRole: RoomRole | null
  error: string | null
  changeRole: (userId: string, role: RoomRole) => Promise<void>
  removeMember: (userId: string) => Promise<void>
}
//#endregion

//#region Hook
// Loads a room's members when the panel opens and exposes owner-only mutations.
// Every call goes through the same-origin /api (cookie sent automatically); the
// server is the authority on who may change what, so the UI just reflects its
// responses and surfaces errors.
export default function useRoomMembers(
  roomId: string,
  isOpen: boolean,
): UseRoomMembersResult {
  const [members, setMembers] = useState<RoomMember[]>([])
  const [myRole, setMyRole] = useState<RoomRole | null>(null)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/rooms/${encodeURIComponent(roomId)}/members`

  // Pure fetch: returns the loaded data or an error string, and touches no state
  // itself. Keeping state OUT of here lets the effect apply it inside a .then
  // callback (a deferred boundary), which is the pattern the react-hooks lint
  // rule accepts for "fetch on mount".
  const fetchMembers = useCallback(async (): Promise<
    { members: RoomMember[]; role: RoomRole } | { error: string }
  > => {
    try {
      const res = await fetch(base)
      if (!res.ok) {
        return {
          error:
            res.status === 401
              ? "Log in to see members."
              : res.status === 403
                ? "You are not a member of this room."
                : "Could not load members.",
        }
      }
      const data = (await res.json()) as {
        role: RoomRole
        members: RoomMember[]
      }
      return { members: data.members, role: data.role }
    } catch {
      return { error: "Could not load members." }
    }
  }, [base])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    let cancelled = false
    fetchMembers().then((result) => {
      if (cancelled) {
        return
      }
      if ("error" in result) {
        setMembers([])
        setMyRole(null)
        setError(result.error)
      } else {
        setMembers(result.members)
        setMyRole(result.role)
        setError(null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, fetchMembers])

  async function mutate(
    input: RequestInfo,
    init: RequestInit,
  ): Promise<void> {
    try {
      const res = await fetch(input, init)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Action failed.")
        return
      }
      setMembers((data as { members: RoomMember[] }).members)
      setError(null)
    } catch {
      setError("Action failed.")
    }
  }

  const changeRole = useCallback(
    (userId: string, role: RoomRole) =>
      mutate(`${base}/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      }),
    [base],
  )

  const removeMember = useCallback(
    (userId: string) =>
      mutate(`${base}/${encodeURIComponent(userId)}`, { method: "DELETE" }),
    [base],
  )

  return { members, myRole, error, changeRole, removeMember }
}
//#endregion
