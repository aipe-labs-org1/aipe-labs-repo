import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/scoring/**/*.test.ts", "lib/launch-checklist/**/*.test.ts"],
    // Exclude Next.js build output and node_modules explicitly for clarity.
    exclude: ["node_modules/**", ".next/**"],
  },
});
