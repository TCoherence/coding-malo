import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "tests/e2e/**"], // e2e runs via `npm run e2e` (real PTY, needs build)
    testTimeout: 20000,
  },
});
