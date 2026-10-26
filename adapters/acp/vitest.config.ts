import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Per-run TMPDIR, removed afterwards: the tests leave mkdtemp() dirs behind.
    globalSetup: ["../../scripts/test-tmpdir.mjs"],
  },
});
