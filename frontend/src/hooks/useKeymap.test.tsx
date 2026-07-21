import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import useKeymap from "./useKeymap"
import type { UseKeymapOptions } from "./useKeymap"

function Harness(props: UseKeymapOptions) {
  useKeymap(props)
  return null
}

function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  )
}

function setup(overrides: Partial<UseKeymapOptions> = {}) {
  const props: UseKeymapOptions = {
    sidebarOpen: true,
    onSelectTool: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    ...overrides,
  }
  render(<Harness {...props} />)
  return props
}

describe("useKeymap", () => {
  it("selects tools by their shortcut while the sidebar is open", () => {
    const { onSelectTool } = setup({ sidebarOpen: true })
    press("p")
    press("e")
    press("f")
    press("s")
    press("i")
    expect(
      (onSelectTool as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]),
    ).toEqual(["pencil", "eraser", "bucket", "spray", "eyedropper"])
  })

  it("ignores tool shortcuts while the sidebar is closed", () => {
    const { onSelectTool } = setup({ sidebarOpen: false })
    press("p")
    expect(onSelectTool).not.toHaveBeenCalled()
  })

  it("does not treat a modified key as a tool shortcut (Ctrl+S = save)", () => {
    const { onSelectTool } = setup()
    press("s", { ctrlKey: true })
    expect(onSelectTool).not.toHaveBeenCalled()
  })

  it("undoes and redoes regardless of the sidebar's state", () => {
    const { onUndo, onRedo } = setup({ sidebarOpen: false })
    press("z", { ctrlKey: true })
    expect(onUndo).toHaveBeenCalledTimes(1)
    press("z", { ctrlKey: true, shiftKey: true })
    expect(onRedo).toHaveBeenCalledTimes(1)
  })

  it("ignores shortcuts while typing in a text field", () => {
    const { onSelectTool } = setup()
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", bubbles: true }),
    )
    expect(onSelectTool).not.toHaveBeenCalled()
    input.remove()
  })
})
