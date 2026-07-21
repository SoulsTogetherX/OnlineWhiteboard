import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { ColorPalette } from "@shared/types/primitive"

import DrawingTab from "./index"
import type { AppTool } from "./tools"

function renderTab(overrides: Partial<Parameters<typeof DrawingTab>[0]> = {}) {
  const colorPalette: React.RefObject<ColorPalette> = {
    current: {
      primary: { r: 0, g: 0, b: 0, a: 255 },
      secondary: { r: 255, g: 255, b: 255, a: 255 },
    },
  }
  const props = {
    selectedTool: "pencil" as AppTool,
    onSelectTool: vi.fn(),
    strokeSize: 4,
    onStrokeSizeChange: vi.fn(),
    sprayDensity: 16,
    onSprayDensityChange: vi.fn(),
    colorPalette,
    onSwap: vi.fn(),
    openColorPopup: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    canUndo: true,
    canRedo: false,
    ...overrides,
  }
  return { props, ...render(<DrawingTab {...props} />) }
}

describe("DrawingTab", () => {
  it("shows the stroke panel for a stroke tool (pencil)", () => {
    renderTab({ selectedTool: "pencil" })
    expect(screen.getByRole("slider")).toBeInTheDocument()
    expect(screen.getByText("Brush size")).toBeInTheDocument()
  })

  it("hides the stroke panel for a non-stroke tool (bucket)", () => {
    renderTab({ selectedTool: "bucket" })
    expect(screen.queryByRole("slider")).not.toBeInTheDocument()
  })

  it("reflects undo/redo availability", () => {
    renderTab({ canUndo: true, canRedo: false })
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled()
  })
})
