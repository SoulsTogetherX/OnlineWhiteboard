import { defineConfig } from "vitest/config"

// Tests live next to the code they cover, in shared/**/__tests__.
//
// The shared/ protocol is the highest-value thing in this repo to test: it is
// pure, dependency-free and deterministic (no DOM, no network, no database),
// and BOTH the browser and the server execute it — so a bug here desynchronises
// every client from the server's authoritative canvas.
//
// No path aliases are configured on purpose: shared/ imports itself relatively
// ("./helperProtocallMethods"), so the tests can too. The @shared alias is a
// convenience for the frontend/backend packages, not something shared/ needs
// internally.
export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts"],
    // These are pure functions over typed arrays — no DOM required. jsdom would
    // only slow the suite down and hide accidental DOM dependencies.
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["shared/**/*.ts"],
      exclude: ["shared/**/*.test.ts", "shared/types/**"],
    },
  },
})
