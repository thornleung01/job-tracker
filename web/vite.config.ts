import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Served from https://thornleung01.github.io/job-tracker/ on GitHub Pages.
export default defineConfig({
  base: "/job-tracker/",
  plugins: [react()],
  test: {
    // Tests never see the committed site-config.json, so adding real IDs to it can't change them.
    // The regex matches the import in src/config.ts, and the replacement is relative to the project root. tests/config/site-config.test.ts checks the real file.
    alias: [
      { find: /^\.\.\/site-config\.json$/, replacement: "/tests/fixtures/site-config.empty.json" },
    ],
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Generous on purpose: the GitHub runner has 2 shared cores. A passing test never waits for these limits.
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
  },
});
