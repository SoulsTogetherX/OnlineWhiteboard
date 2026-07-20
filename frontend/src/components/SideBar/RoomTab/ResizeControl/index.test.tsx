import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import ResizeControl from "./index"

describe("ResizeControl", () => {
  it("disables the toggle for a non-owner and never reveals the form", async () => {
    const user = userEvent.setup()
    render(
      <ResizeControl width={256} height={256} disabled onResize={() => {}} />,
    )
    const toggle = screen.getByRole("button", { name: /Resize canvas/ })
    expect(toggle).toBeDisabled()
    await user.click(toggle)
    expect(screen.queryByLabelText("Width")).not.toBeInTheDocument()
  })

  it("reveals inputs pre-filled with the current size when opened", async () => {
    const user = userEvent.setup()
    render(
      <ResizeControl
        width={128}
        height={200}
        disabled={false}
        onResize={() => {}}
      />,
    )
    await user.click(screen.getByRole("button", { name: /Resize canvas/ }))
    expect(screen.getByLabelText("Width")).toHaveValue(128)
    expect(screen.getByLabelText("Height")).toHaveValue(200)
  })

  it("clamps out-of-range values to [16, 512] before calling onResize", async () => {
    const onResize = vi.fn()
    const user = userEvent.setup()
    render(
      <ResizeControl
        width={256}
        height={256}
        disabled={false}
        onResize={onResize}
      />,
    )
    await user.click(screen.getByRole("button", { name: /Resize canvas/ }))

    const width = screen.getByLabelText("Width")
    const height = screen.getByLabelText("Height")
    await user.clear(width)
    await user.type(width, "999")
    await user.clear(height)
    await user.type(height, "4")
    await user.click(screen.getByRole("button", { name: "Apply" }))

    expect(onResize).toHaveBeenCalledWith(512, 16)
  })

  it("passes a valid size through unchanged", async () => {
    const onResize = vi.fn()
    const user = userEvent.setup()
    render(
      <ResizeControl
        width={256}
        height={256}
        disabled={false}
        onResize={onResize}
      />,
    )
    await user.click(screen.getByRole("button", { name: /Resize canvas/ }))
    const width = screen.getByLabelText("Width")
    await user.clear(width)
    await user.type(width, "300")
    await user.click(screen.getByRole("button", { name: "Apply" }))
    expect(onResize).toHaveBeenCalledWith(300, 256)
  })
})
