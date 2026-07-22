import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { CheckpointInfo } from "@shared/types/socketProtocol"

import CheckpointList from "./index"

const checkpoint: CheckpointInfo = {
  id: "cp1",
  name: "First pass",
  revision: 10,
  createdAt: new Date(0).toISOString(),
}

function renderList(overrides = {}) {
  const props = {
    checkpoints: [checkpoint],
    canEdit: true,
    onCreate: vi.fn(),
    onRestore: vi.fn(),
    onDelete: vi.fn(),
    onReplay: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<CheckpointList {...props} />) }
}

describe("CheckpointList", () => {
  it("lets an editor save a named checkpoint", async () => {
    const user = userEvent.setup()
    const { props } = renderList({ canEdit: true })
    await user.type(screen.getByLabelText("Checkpoint name"), "Sketch")
    await user.click(screen.getByRole("button", { name: "Save" }))
    expect(props.onCreate).toHaveBeenCalledWith("Sketch")
  })

  it("offers replay to everyone (including non-editors), but hides save/restore/delete", () => {
    renderList({ canEdit: false })
    expect(
      screen.getByRole("button", { name: "▶ Replay recent history" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "▶ Replay" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Restore" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Delete/)).not.toBeInTheDocument()
  })

  it("replays a specific checkpoint and recent history", async () => {
    const user = userEvent.setup()
    const { props } = renderList()
    await user.click(screen.getByRole("button", { name: "▶ Replay" }))
    expect(props.onReplay).toHaveBeenLastCalledWith("cp1")
    await user.click(
      screen.getByRole("button", { name: "▶ Replay recent history" }),
    )
    // "recent history" replays from no specific checkpoint (no argument).
    expect(props.onReplay).toHaveBeenLastCalledWith()
  })

  it("restores and deletes for an editor", async () => {
    const user = userEvent.setup()
    const { props } = renderList({ canEdit: true })
    await user.click(screen.getByRole("button", { name: "Restore" }))
    expect(props.onRestore).toHaveBeenCalledWith("cp1")
    await user.click(screen.getByRole("button", { name: "Delete First pass" }))
    expect(props.onDelete).toHaveBeenCalledWith("cp1")
  })
})
