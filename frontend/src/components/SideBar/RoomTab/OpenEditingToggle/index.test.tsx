import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import OpenEditingToggle from "./index"

describe("OpenEditingToggle", () => {
  it("reflects the current setting as a checkbox state", () => {
    render(
      <OpenEditingToggle enabled disabled={false} onChange={() => {}} />,
    )
    expect(screen.getByRole("checkbox")).toBeChecked()
  })

  it("reports the new value when toggled by an owner", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <OpenEditingToggle enabled={false} disabled={false} onChange={onChange} />,
    )
    await user.click(screen.getByRole("checkbox"))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("is not operable when disabled for a non-owner", async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <OpenEditingToggle enabled onChange={onChange} disabled />,
    )
    const checkbox = screen.getByRole("checkbox")
    expect(checkbox).toBeDisabled()
    await user.click(checkbox)
    expect(onChange).not.toHaveBeenCalled()
  })
})
