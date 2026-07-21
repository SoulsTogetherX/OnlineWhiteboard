import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ConnectionRole, Participant } from "@shared/types/identity"

import RoomTab from "./index"

function participant(role: ConnectionRole, isGuest = false): Participant {
  return {
    connectionId: "c1",
    name: role === "guest" ? "Guest" : "Member",
    color: "#123456",
    isGuest,
    role,
  }
}

function renderTab(overrides: Partial<Parameters<typeof RoomTab>[0]> = {}) {
  const props = {
    participants: [participant("owner")],
    self: participant("owner"),
    openEditing: true,
    hasOwner: true,
    canvasWidth: 256,
    canvasHeight: 256,
    onClaimOwnership: vi.fn(),
    onReleaseOwnership: vi.fn(),
    onSetOpenEditing: vi.fn(),
    onResize: vi.fn(),
    onClear: vi.fn(),
    onDownload: vi.fn(),
    editorRequests: [],
    onRequestEditor: vi.fn(),
    onRespondEditor: vi.fn(),
    showCursors: true,
    showCursorNames: true,
    onShowCursorsChange: vi.fn(),
    onShowCursorNamesChange: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<RoomTab {...props} />) }
}

// The open-editing toggle is now one of several checkboxes (the cursor
// preferences add more), so it must be queried by its accessible name.
const OPEN_EDITING = "Let guests & viewers draw"

describe("RoomTab permission gating", () => {
  it("shows an owner the enabled management controls", () => {
    renderTab({ self: participant("owner"), hasOwner: true })
    expect(
      screen.getByRole("button", { name: "Release ownership" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: OPEN_EDITING })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Clear canvas" })).toBeEnabled()
    expect(screen.getByRole("button", { name: /Resize canvas/ })).toBeEnabled()
  })

  it("greys the owner-only controls for a viewer and offers the editor request", () => {
    renderTab({ self: participant("viewer"), hasOwner: true })
    expect(screen.getByRole("checkbox", { name: OPEN_EDITING })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Clear canvas" })).toBeDisabled()
    expect(
      screen.getByRole("button", { name: /Resize canvas/ }),
    ).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Request editor access" }),
    ).toBeInTheDocument()
  })

  it("gives a guest no owner controls, no editor request, and a disabled claim", () => {
    renderTab({
      self: participant("guest", true),
      hasOwner: false,
      participants: [participant("guest", true)],
    })
    expect(screen.getByRole("button", { name: "Clear canvas" })).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: "Request editor access" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Claim ownership" }),
    ).toBeDisabled()
  })

  it("only renders the editor-request queue for the owner", () => {
    const requests = [{ userId: "u9", name: "Lin" }]
    const asViewer = renderTab({ self: participant("viewer"), editorRequests: requests })
    expect(asViewer.queryByText("Editor requests")).not.toBeInTheDocument()
    asViewer.unmount()

    renderTab({ self: participant("owner"), editorRequests: requests })
    expect(screen.getByText("Editor requests")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approve Lin" })).toBeInTheDocument()
  })

  it("download is available to everyone, including guests", () => {
    renderTab({ self: participant("guest", true), hasOwner: false })
    expect(screen.getByRole("button", { name: "Download image" })).toBeEnabled()
  })
})
