import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import ToolPicker from "./index"

describe("ToolPicker", () => {
  it("shows the active tool and no menu until opened", () => {
    render(<ToolPicker selectedTool="pencil" onSelectTool={() => {}} />)
    expect(
      screen.getByRole("button", { name: "Tool: Pencil" }),
    ).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("opens the list and reports the chosen tool, then closes", async () => {
    const onSelectTool = vi.fn()
    const user = userEvent.setup()
    render(<ToolPicker selectedTool="pencil" onSelectTool={onSelectTool} />)

    await user.click(screen.getByRole("button", { name: "Tool: Pencil" }))
    expect(screen.getByRole("listbox")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Eraser/ }))
    expect(onSelectTool).toHaveBeenCalledWith("eraser")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })

  it("marks the active tool as the selected option", async () => {
    const user = userEvent.setup()
    render(<ToolPicker selectedTool="spray" onSelectTool={() => {}} />)
    await user.click(screen.getByRole("button", { name: "Tool: Spray" }))
    expect(screen.getByRole("option", { name: /Spray/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })

  it("closes on Escape", async () => {
    const user = userEvent.setup()
    render(<ToolPicker selectedTool="pencil" onSelectTool={() => {}} />)
    await user.click(screen.getByRole("button", { name: "Tool: Pencil" }))
    expect(screen.getByRole("listbox")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
  })
})
