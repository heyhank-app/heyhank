import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.ts"],
    environmentMatchGlobs: [
      ["src/**/*.test.ts", "jsdom"],
    ],
    setupFiles: ["src/test-setup.ts"],
  },
});
