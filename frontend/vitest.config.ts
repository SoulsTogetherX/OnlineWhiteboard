import path from "node:path"

import { defineConfig } from "vitest/config"

// Frontend unit tests — currently the pure colour-space maths (utils/color.ts),
// which is deterministic and DOM-free, so it runs in the node environment. The
// @ and @shared aliases mirror the app's so tests import exactly as it does.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
