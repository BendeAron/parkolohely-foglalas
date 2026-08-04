import { defineConfig } from "vitest/config";

/**
 * Unit tests only — pure functions, no network, no database.
 * Fast enough to run on every save.
 *
 * Integration tests live behind vitest.integration.config.js because they
 * need the API and PostgreSQL running, and mixing them here would mean a
 * broken Docker stack looks like a broken test suite.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.js"],
    exclude: ["src/tests/**/*.integration.test.js", "**/node_modules/**"],
    globals: false,
  },
});