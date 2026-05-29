import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.tsx" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  sourcemap: true,
  dts: false,
  // Keep dependencies external — resolved from node_modules at runtime. A standalone
  // single-file bundle / Node SEA is an M7 packaging concern.
  skipNodeModulesBundle: true,
});
