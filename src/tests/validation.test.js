import { defineConfig } from "vitest/config";

/**
 * Integration tests — require the full Docker stack to be up.
 *
 * Run serially: these tests create and cancel real reservations against a
 * shared database, so parallel workers would fight over the same spots and
 * produce false 409s.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.integration.test.js"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Vitest 4 removed `poolOptions` — these are top-level now.
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});