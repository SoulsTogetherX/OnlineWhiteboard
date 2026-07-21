import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import OwnershipButton from "./index"

describe("OwnershipButton", () => {
  it("shows Release and fires onRelease when this connection owns the room", async () => {
    const onRelease = vi.fn()
    const user = userEvent.setup()
    render(
      <OwnershipButton
        isOwner
        hasOwner
        isGuest={false}
        onClaim={() => {}}
        onRelease={onRelease}
      />,
    )
    const button = screen.getByRole("button", { name: "Release ownership" })
    await user.click(button)
    expect(onRelease).toHaveBeenCalledOnce()
  })

  it("shows an enabled Claim when the room is unowned and the user is signed in", async () => {
    const onClaim = vi.fn()
    const user = userEvent.setup()
    render(
      <OwnershipButton
        isOwner={false}
        hasOwner={false}
        isGuest={false}
        onClaim={onClaim}
        onRelease={() => {}}
      />,
    )
    const button = screen.getByRole("button", { name: "Claim ownership" })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(onClaim).toHaveBeenCalledOnce()
  })

  it("disables Claim and explains why for a guest", () => {
    render(
      <OwnershipButton
        isOwner={false}
        hasOwner={false}
        isGuest
        onClaim={() => {}}
        onRelease={() => {}}
      />,
    )
    expect(screen.getByRole("button", { name: "Claim ownership" })).toBeDisabled()
    expect(
      screen.getByText("Log in to claim or manage this room."),
    ).toBeInTheDocument()
  })

  it("shows the log-in hint for a guest even when the room is owned", () => {
    // Guest takes priority over has-owner: a guest can't manage regardless, and
    // "Owned by another user" was misleading (the owner may be this same person
    // logged in on another tab).
    render(
      <OwnershipButton
        isOwner={false}
        hasOwner
        isGuest
        onClaim={() => {}}
        onRelease={() => {}}
      />,
    )
    expect(
      screen.getByText("Log in to claim or manage this room."),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Owned by another user" }),
    ).not.toBeInTheDocument()
  })

  it("shows a disabled informational state when someone else owns the room", () => {
    render(
      <OwnershipButton
        isOwner={false}
        hasOwner
        isGuest={false}
        onClaim={() => {}}
        onRelease={() => {}}
      />,
    )
    const button = screen.getByRole("button", { name: "Owned by another user" })
    expect(button).toBeDisabled()
  })
})
