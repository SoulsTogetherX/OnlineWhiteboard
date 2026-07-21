import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { Participant } from "@shared/types/identity"
import type { Vec } from "@shared/types/primitive"

import CursorOverlay from "./index"

function renderOverlay(overrides: Partial<Parameters<typeof CursorOverlay>[0]> = {}) {
  const participant: Participant = {
    connectionId: "c2",
    name: "Ada",
    // A pale identity colour — the case that used to be unreadable with white text.
    color: "#bfef45",
    isGuest: false,
    role: "editor",
  }
  const props = {
    canvasRef: { current: document.createElement("canvas") },
    cursorsRef: { current: new Map<string, Vec>([["c2", [1, 1]]]) },
    cursorIds: ["c2"],
    participants: [participant],
    showCursors: true,
    showNames: true,
    ...overrides,
  }
  return render(<CursorOverlay {...props} />)
}

describe("CursorOverlay display preferences", () => {
  it("shows the name label with contrast-picked dark text on a pale colour", () => {
    const { container } = renderOverlay()
    const label = container.querySelector(".remote-cursor-label") as HTMLElement
    expect(label).not.toBeNull()
    expect(label.textContent).toBe("Ada")
    // readableTextColor("#bfef45") -> black; jsdom normalises to rgb().
    expect(label.style.color).toBe("rgb(0, 0, 0)")
  })

  it("keeps the arrow but drops the label when names are hidden", () => {
    const { container } = renderOverlay({ showNames: false })
    expect(container.querySelector(".remote-cursor")).not.toBeNull()
    expect(container.querySelector(".remote-cursor-arrow")).not.toBeNull()
    expect(container.querySelector(".remote-cursor-label")).toBeNull()
  })

  it("renders no cursors at all when cursors are hidden", () => {
    const { container } = renderOverlay({ showCursors: false })
    expect(container.querySelector(".remote-cursor")).toBeNull()
  })
})
