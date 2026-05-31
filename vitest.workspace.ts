import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "unit",
    include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
