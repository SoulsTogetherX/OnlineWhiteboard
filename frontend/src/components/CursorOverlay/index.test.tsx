import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { Participant } from "@shared/types/identity"
import type { Vec } from "@shared/types/primitive"

import CursorOverlay from "./index"
import { toolById } from "@/components/SideBar/DrawingTab/tools"

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
    cursorTools: { c2: "spray" as const },
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

  it("keeps the cursor but drops the label when names are hidden", () => {
    const { container } = renderOverlay({ showNames: false })
    expect(container.querySelector(".remote-cursor")).not.toBeNull()
    expect(container.querySelector(".remote-cursor-tool")).not.toBeNull()
    expect(container.querySelector(".remote-cursor-label")).toBeNull()
  })

  it("draws the tool the cursor is holding, not a generic arrow", () => {
    const { container } = renderOverlay({ cursorTools: { c2: "spray" } })
    const spray = container.querySelector(".remote-cursor-tool path")
    expect(spray?.getAttribute("d")).toBe(toolById("spray").iconPath)
  })

  it("falls back to the pencil when a cursor's tool is unknown", () => {
    // An older client, or one that has not moved since picking a tool.
    const { container } = renderOverlay({ cursorTools: {} })
    const glyph = container.querySelector(".remote-cursor-tool path")
    expect(glyph?.getAttribute("d")).toBe(toolById("pencil").iconPath)
  })

  it("renders no cursors at all when cursors are hidden", () => {
    const { container } = renderOverlay({ showCursors: false })
    expect(container.querySelector(".remote-cursor")).toBeNull()
  })
})
