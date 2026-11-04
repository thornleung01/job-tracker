import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Served from https://thornleung01.github.io/job-tracker/ on GitHub Pages.
export default defineConfig({
  base: "/job-tracker/",
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 20000,
  },
});
