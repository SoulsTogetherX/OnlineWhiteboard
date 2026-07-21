import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import CursorControls from "./index"

function renderControls(overrides = {}) {
  const props = {
    showCursors: true,
    showNames: true,
    onShowCursorsChange: vi.fn(),
    onShowNamesChange: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<CursorControls {...props} />) }
}

describe("CursorControls", () => {
  it("reports toggling cursor visibility", async () => {
    const user = userEvent.setup()
    const { props } = renderControls({ showCursors: true })
    await user.click(screen.getByRole("checkbox", { name: "Show other cursors" }))
    expect(props.onShowCursorsChange).toHaveBeenCalledWith(false)
  })

  it("reports toggling cursor names", async () => {
    const user = userEvent.setup()
    const { props } = renderControls({ showNames: true })
    await user.click(screen.getByRole("checkbox", { name: "Show cursor names" }))
    expect(props.onShowNamesChange).toHaveBeenCalledWith(false)
  })

  it("disables the names toggle while cursors are hidden", () => {
    renderControls({ showCursors: false })
    expect(
      screen.getByRole("checkbox", { name: "Show cursor names" }),
    ).toBeDisabled()
  })
})
