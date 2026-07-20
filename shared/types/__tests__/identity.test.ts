// The authorisation rules, as a table.
//
// These predicates are the single source of truth for permissions: the server
// enforces with them and the client greys out controls with them. If they are
// wrong, the UI and the server are wrong together and consistently, which is the
// hardest kind of bug to notice.

import { describe, expect, it } from "vitest"

import {
  ROLES,
  canDraw,
  canManageRoom,
  canRequestEditor,
  hasEditAuthority,
} from "../identity"

import type { ConnectionRole } from "../identity"

const ALL_ROLES: ConnectionRole[] = ["owner", "editor", "viewer", "guest"]

describe("the permission matrix", () => {
  // Rows are roles; columns are the four questions the app ever asks.
  // openEditing is varied separately below because it is the one rule that
  // depends on room state rather than role alone.
  const table: Array<{
    role: ConnectionRole
    drawOpen: boolean
    drawLocked: boolean
    editAuthority: boolean
    manage: boolean
    requestEditor: boolean
  }> = [
    {
      role: "owner",
      drawOpen: true,
      drawLocked: true,
      editAuthority: true,
      manage: true,
      requestEditor: false,
    },
    {
      role: "editor",
      drawOpen: true,
      drawLocked: true,
      editAuthority: true,
      manage: false,
      requestEditor: false,
    },
    {
      role: "viewer",
      drawOpen: true,
      drawLocked: false,
      editAuthority: false,
      manage: false,
      requestEditor: true,
    },
    {
      role: "guest",
      drawOpen: true,
      drawLocked: false,
      editAuthority: false,
      manage: false,
      // A guest has no account to promote, so there is nothing to request.
      requestEditor: false,
    },
  ]

  for (const row of table) {
    it(`${row.role}: draw(open)=${row.drawOpen} draw(locked)=${row.drawLocked} edit=${row.editAuthority} manage=${row.manage} request=${row.requestEditor}`, () => {
      expect(canDraw(row.role, true)).toBe(row.drawOpen)
      expect(canDraw(row.role, false)).toBe(row.drawLocked)
      expect(hasEditAuthority(row.role)).toBe(row.editAuthority)
      expect(canManageRoom(row.role)).toBe(row.manage)
      expect(canRequestEditor(row.role)).toBe(row.requestEditor)
    })
  }
})

describe("open editing", () => {
  it("never revokes drawing from owner or editor", () => {
    // Locking a room restricts everyone ELSE. An owner locking themselves out
    // of their own board would be an obvious foot-gun.
    expect(canDraw("owner", false)).toBe(true)
    expect(canDraw("editor", false)).toBe(true)
  })

  it("is the only thing standing between a viewer/guest and the canvas", () => {
    expect(canDraw("viewer", true)).toBe(true)
    expect(canDraw("viewer", false)).toBe(false)
    expect(canDraw("guest", true)).toBe(true)
    expect(canDraw("guest", false)).toBe(false)
  })

  it("treats guests and viewers identically", () => {
    // Deliberate: if a signed-in reader could do LESS than an anonymous guest,
    // signing in would visibly reduce what you can do, which reads as a bug.
    for (const open of [true, false]) {
      expect(canDraw("guest", open)).toBe(canDraw("viewer", open))
    }
  })
})

describe("exactly one role manages a room", () => {
  it("grants management to owner alone", () => {
    const managers = ALL_ROLES.filter((role) => canManageRoom(role))
    expect(managers).toEqual(["owner"])
  })

  it("grants edit authority to owner and editor only", () => {
    const authorities = ALL_ROLES.filter((role) => hasEditAuthority(role))
    expect(authorities).toEqual(["owner", "editor"])
  })
})

describe("ROLES list", () => {
  it("contains exactly the storable roles, and not the connection-only guest", () => {
    // "guest" is a CONNECTION role — it describes someone with no membership
    // row — so it must never be assignable or storable.
    expect([...ROLES]).toEqual(["owner", "editor", "viewer"])
    expect((ROLES as readonly string[]).includes("guest")).toBe(false)
  })
})
