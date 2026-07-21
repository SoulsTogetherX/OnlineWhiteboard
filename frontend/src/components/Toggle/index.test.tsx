import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import Toggle from "./index"

describe("Toggle", () => {
  it("reflects the checked state and its label", () => {
    render(<Toggle checked onChange={() => {}} label="Show cursors" />)
    expect(screen.getByRole("checkbox", { name: "Show cursors" })).toBeChecked()
  })

  it("reports the new value on click", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Toggle checked={false} onChange={onChange} label="Show cursors" />)
    await user.click(screen.getByRole("checkbox", { name: "Show cursors" }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("is not operable when disabled", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Toggle checked disabled onChange={onChange} label="Show cursors" />,
    )
    const checkbox = screen.getByRole("checkbox", { name: "Show cursors" })
    expect(checkbox).toBeDisabled()
    await user.click(checkbox)
    expect(onChange).not.toHaveBeenCalled()
  })
})
