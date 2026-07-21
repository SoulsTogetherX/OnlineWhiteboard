import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { ColorPalette } from "@shared/types/primitive"

import ColorControls from "./index"

function paletteRef(): React.RefObject<ColorPalette> {
  return {
    current: {
      primary: { r: 0, g: 0, b: 0, a: 255 },
      secondary: { r: 255, g: 255, b: 255, a: 255 },
    },
  }
}

describe("ColorControls", () => {
  it("opens the picker for the primary and secondary swatches", async () => {
    const openColorPopup = vi.fn()
    const user = userEvent.setup()
    render(
      <ColorControls
        colorPalette={paletteRef()}
        onSwap={() => {}}
        openColorPopup={openColorPopup}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Change primary color" }))
    expect(openColorPopup).toHaveBeenLastCalledWith(true)
    await user.click(
      screen.getByRole("button", { name: "Change secondary color" }),
    )
    expect(openColorPopup).toHaveBeenLastCalledWith(false)
  })

  it("requests a swap", async () => {
    const onSwap = vi.fn()
    const user = userEvent.setup()
    render(
      <ColorControls
        colorPalette={paletteRef()}
        onSwap={onSwap}
        openColorPopup={() => {}}
      />,
    )
    await user.click(
      screen.getByRole("button", { name: "Swap primary and secondary colors" }),
    )
    expect(onSwap).toHaveBeenCalledOnce()
  })
})
