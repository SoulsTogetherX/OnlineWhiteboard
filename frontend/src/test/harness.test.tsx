import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

// Self-test for the jsdom + Testing Library stack, not for any app code. It
// exercises every piece the component projects depends on — the react JSX
// transform, jsdom rendering, the jest-dom matchers from the setup file, and
// user-event interaction — so if the vitest config regresses, this fails loudly
// instead of the whole component suite failing for a confusing reason.
function Counter() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount((n) => n + 1)}>count: {count}</button>
}

describe("test harness", () => {
  it("renders a component into jsdom and applies jest-dom matchers", () => {
    render(<Counter />)
    expect(screen.getByRole("button")).toBeInTheDocument()
    expect(screen.getByRole("button")).toHaveTextContent("count: 0")
  })

  it("dispatches user-event interactions and re-renders on state change", async () => {
    const user = userEvent.setup()
    render(<Counter />)
    await user.click(screen.getByRole("button"))
    await user.click(screen.getByRole("button"))
    expect(screen.getByRole("button")).toHaveTextContent("count: 2")
  })
})
