import path from "node:path"

import { defineConfig } from "vitest/config"

// Backend tests are INTEGRATION tests: they run against a real Postgres, unlike
// the pure shared/ unit tests at the repo root. They are gated on a reachable
// database (see the `describe.skipIf` in the test files) so `npm test` stays
// green on a machine with no database, and only actually run in CI (where a
// postgres service container is provided) or locally when you point them at the
// dev stack's database.
//
// The @ and @shared aliases mirror backend/tsconfig.json so the test files can
// import the repository exactly as the app does.
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
    // One Postgres, shared across files — run serially so tests can't stomp on
    // each other's rows. They already isolate by unique room id, but a single
    // fork keeps ordering and teardown simple.
    fileParallelism: false,
  },
})
