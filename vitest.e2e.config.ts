import { defineConfig } from "vitest/config";

// End-to-end terminal tests: spawn the built `dist/cli.js` in a real PTY (node-pty) and read the
// rendered screen back through a headless terminal emulator (@xterm/headless). Run with `npm run e2e`
// (which builds first). Kept separate from the fast unit suite — these are slower and need the build.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false, // each test owns a PTY + (mock) server; keep them sequential
  },
});
