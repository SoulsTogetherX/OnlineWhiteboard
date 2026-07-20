import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { SIDEBAR_TABS } from "../types"
import TabBar from "./index"

describe("TabBar", () => {
  it("renders one tab button per descriptor, marking the active one selected", () => {
    render(
      <TabBar tabs={SIDEBAR_TABS} activeTab="room" onTabChange={() => {}} />,
    )
    const tabs = screen.getAllByRole("tab")
    expect(tabs).toHaveLength(SIDEBAR_TABS.length)
    expect(screen.getByRole("tab", { name: "Room" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByRole("tab", { name: "Drawing" })).toHaveAttribute(
      "aria-selected",
      "false",
    )
  })

  it("makes only the active tab tabbable (roving tabindex)", () => {
    render(
      <TabBar tabs={SIDEBAR_TABS} activeTab="room" onTabChange={() => {}} />,
    )
    expect(screen.getByRole("tab", { name: "Room" })).toHaveAttribute(
      "tabindex",
      "0",
    )
    expect(screen.getByRole("tab", { name: "Drawing" })).toHaveAttribute(
      "tabindex",
      "-1",
    )
  })

  it("reports the clicked tab", async () => {
    const onTabChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TabBar tabs={SIDEBAR_TABS} activeTab="drawing" onTabChange={onTabChange} />,
    )
    await user.click(screen.getByRole("tab", { name: "Timeline" }))
    expect(onTabChange).toHaveBeenCalledWith("timeline")
  })

  it("moves selection with Left/Right arrows, wrapping at the ends", async () => {
    const onTabChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TabBar tabs={SIDEBAR_TABS} activeTab="drawing" onTabChange={onTabChange} />,
    )
    screen.getByRole("tab", { name: "Drawing" }).focus()
    await user.keyboard("{ArrowRight}")
    expect(onTabChange).toHaveBeenLastCalledWith("room")

    // Left from the first tab wraps to the last.
    await user.keyboard("{ArrowLeft}")
    expect(onTabChange).toHaveBeenLastCalledWith("timeline")
  })

  it("jumps to the first/last tab with Home/End", async () => {
    const onTabChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TabBar tabs={SIDEBAR_TABS} activeTab="room" onTabChange={onTabChange} />,
    )
    screen.getByRole("tab", { name: "Room" }).focus()
    await user.keyboard("{End}")
    expect(onTabChange).toHaveBeenLastCalledWith("timeline")
    await user.keyboard("{Home}")
    expect(onTabChange).toHaveBeenLastCalledWith("drawing")
  })
})
