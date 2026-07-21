import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import LabelledSlider from "./index"

describe("LabelledSlider", () => {
  it("renders the label and the formatted value", () => {
    render(
      <LabelledSlider
        label="Brush size"
        value={8}
        min={1}
        max={32}
        format={(v) => `${v}px`}
        onChange={() => {}}
      />,
    )
    expect(screen.getByText("Brush size")).toBeInTheDocument()
    expect(screen.getByText("8px")).toBeInTheDocument()
    expect(screen.getByRole("slider")).toHaveValue("8")
  })

  it("reports numeric changes", () => {
    const onChange = vi.fn()
    render(
      <LabelledSlider label="Size" value={4} min={1} max={32} onChange={onChange} />,
    )
    fireEvent.change(screen.getByRole("slider"), { target: { value: "10" } })
    expect(onChange).toHaveBeenCalledWith(10)
  })
})
