import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Served from https://thornleung01.github.io/job-tracker/ on GitHub Pages.
export default defineConfig({
  base: "/job-tracker/",
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Generous on purpose: the GitHub runner has 2 shared cores. A passing test never waits for these limits.
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
  },
});
