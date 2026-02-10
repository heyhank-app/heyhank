import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    environmentMatchGlobs: [
      ["src/**/*.test.ts", "jsdom"],
      ["src/**/*.test.tsx", "jsdom"],
    ],
    setupFiles: ["src/test-setup.ts"],
  },
});
