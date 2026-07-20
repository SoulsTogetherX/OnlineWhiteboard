import path from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// The @ and @shared aliases mirror the app's so tests import exactly as it does.
const alias = {
  "@": path.resolve(__dirname, "./src"),
  "@shared": path.resolve(__dirname, "../shared"),
}

// Two projects, split by what each test needs — keeping the pure maths in the
// fast DOM-free node env while component tests get jsdom. The split is by file
// extension, not folder: pure logic is `*.test.ts`, React components are
// `*.test.tsx`, so a test lands in the right environment by how it's named.
export default defineConfig({
  test: {
    projects: [
      {
        // Pure logic (colour maths, localHold, reanchor) — deterministic and
        // DOM-free, so no jsdom cost.
        resolve: { alias },
        test: {
          name: "node",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // Component tests — React Testing Library rendered into jsdom. The react
        // plugin supplies the JSX transform; the setup file wires jest-dom
        // matchers and auto-cleanup between tests.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "jsdom",
          include: ["src/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
})
