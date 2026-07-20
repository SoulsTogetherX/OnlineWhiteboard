import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import SideBar from "./index"

function renderShell(overrides: Partial<Parameters<typeof SideBar>[0]> = {}) {
  const props = {
    isOpen: true,
    onToggle: vi.fn(),
    activeTab: "drawing" as const,
    onTabChange: vi.fn(),
    children: <p>panel body</p>,
    ...overrides,
  }
  return { props, ...render(<SideBar {...props} />) }
}

describe("SideBar", () => {
  it("renders the active panel content the composition root passes in", () => {
    renderShell()
    expect(screen.getByText("panel body")).toBeInTheDocument()
  })

  it("ties the panel to its tab via aria-labelledby / id", () => {
    renderShell({ activeTab: "room" })
    const panel = screen.getByRole("tabpanel")
    expect(panel).toHaveAttribute("id", "sidebar-panel-room")
    expect(panel).toHaveAttribute("aria-labelledby", "sidebar-tab-room")
  })

  it("toggles via the handle and reflects the open state to assistive tech", async () => {
    const user = userEvent.setup()
    const { props } = renderShell({ isOpen: true })
    const handle = screen.getByRole("button", { name: "Collapse sidebar" })
    expect(handle).toHaveAttribute("aria-expanded", "true")
    await user.click(handle)
    expect(props.onToggle).toHaveBeenCalledOnce()
  })

  it("labels the handle for expanding when collapsed", () => {
    renderShell({ isOpen: false })
    const handle = screen.getByRole("button", { name: "Expand sidebar" })
    expect(handle).toHaveAttribute("aria-expanded", "false")
  })

  it("makes the collapsed body inert so its controls leave the tab order", () => {
    const { container } = renderShell({ isOpen: false })
    const body = container.querySelector("#sidebar-body")
    expect(body).toHaveAttribute("inert")
  })

  it("drops inert from the body when open", () => {
    const { container } = renderShell({ isOpen: true })
    const body = container.querySelector("#sidebar-body")
    expect(body).not.toHaveAttribute("inert")
  })
})
