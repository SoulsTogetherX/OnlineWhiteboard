import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AuthUser } from "@shared/types/identity"

import AccountTab from "./index"

const ADA: AuthUser = {
  id: "u1",
  username: "Ada",
  color: "#ff8800",
  isGuest: false,
}

function renderTab(overrides: Partial<Parameters<typeof AccountTab>[0]> = {}) {
  const props = {
    user: ADA as AuthUser | null,
    onOpenAuth: vi.fn(),
    onLogout: vi.fn(),
    onUpdateUsername: vi.fn().mockResolvedValue({ ok: true }),
    onDeleteAccount: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
  return { props, ...render(<AccountTab {...props} />) }
}

describe("AccountTab while signed out", () => {
  it("offers a way in and nothing else", () => {
    renderTab({ user: null })
    expect(
      screen.getByRole("button", { name: "Log in or register" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Delete account" }),
    ).not.toBeInTheDocument()
  })
})

describe("AccountTab rename", () => {
  it("cannot save until the name actually changes", () => {
    renderTab()
    // Seeded with the current name, so there is nothing to save yet.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
  })

  it("saves a changed name", async () => {
    const { props } = renderTab()
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Grace" },
    })
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() =>
      expect(props.onUpdateUsername).toHaveBeenCalledWith("Grace"),
    )
  })

  it("reports why a rename was refused", async () => {
    const { props } = renderTab({
      onUpdateUsername: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "Username must be 2–32 characters." }),
    })
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "G" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(props.onUpdateUsername).toHaveBeenCalled())
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Username must be 2–32 characters.",
    )
  })
})

describe("AccountTab deletion", () => {
  // Irreversible, so it must not be one click away.
  it("asks for a second, deliberate confirmation", () => {
    const { props } = renderTab()
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    expect(props.onDeleteAccount).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "Delete for good" }),
    ).toBeInTheDocument()
  })

  it("deletes only after the confirmation", async () => {
    const { props } = renderTab()
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }))
    await waitFor(() => expect(props.onDeleteAccount).toHaveBeenCalled())
  })

  it("can be backed out of", () => {
    const { props } = renderTab()
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(props.onDeleteAccount).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "Delete account" }),
    ).toBeInTheDocument()
  })
})
