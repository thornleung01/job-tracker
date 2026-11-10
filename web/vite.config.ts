import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Served from https://thornleung01.github.io/job-tracker/ on GitHub Pages.
export default defineConfig({
  base: "/job-tracker/",
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React and Dexie change rarely: in their own file they stay cached across releases of the app's own code.
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (id.includes("/node_modules/dexie/")) return "dexie";
          return undefined;
        },
      },
    },
  },
  test: {
    // Tests never see the committed site-config.json, so adding real IDs to it can't change them.
    // The regex matches the import in src/config.ts, and the replacement is relative to the project root. tests/config/site-config.test.ts checks the real file.
    alias: [
      { find: /^\.\.\/site-config\.json$/, replacement: "/tests/fixtures/site-config.empty.json" },
    ],
    // The same for the build-time IDs: a developer's web/.env.local must not turn a "no IDs" test into a "build IDs" one.
    env: { VITE_GOOGLE_CLIENT_ID: "", VITE_MS_CLIENT_ID: "" },
    environment: "jsdom",
    setupFiles: ["tests/support/setup.ts"],
    // A spy or stubbed global from one test never reaches the next, even when an assertion throws before its own cleanup.
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Generous on purpose: the GitHub runner has 2 shared cores. A passing test never waits for these limits.
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 30000,
  },
});
