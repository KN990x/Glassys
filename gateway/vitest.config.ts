import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    // Per-run TMPDIR, removed afterwards: the tests leave hundreds of mkdtemp() dirs behind.
    globalSetup: ["../scripts/test-tmpdir.mjs"],
  },
});
