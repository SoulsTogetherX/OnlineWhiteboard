import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import EditorRequests from "./index"

describe("EditorRequests", () => {
  it("renders nothing when the queue is empty", () => {
    const { container } = render(
      <EditorRequests requests={[]} onRespond={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("lists each request with approve/deny wired to the right user", async () => {
    const onRespond = vi.fn()
    const user = userEvent.setup()
    render(
      <EditorRequests
        requests={[
          { userId: "u1", name: "Ada" },
          { userId: "u2", name: "Grace" },
        ]}
        onRespond={onRespond}
      />,
    )
    expect(screen.getByText("Ada")).toBeInTheDocument()
    expect(screen.getByText("Grace")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Approve Ada" }))
    expect(onRespond).toHaveBeenCalledWith("u1", true)

    await user.click(screen.getByRole("button", { name: "Deny Grace" }))
    expect(onRespond).toHaveBeenCalledWith("u2", false)
  })
})
