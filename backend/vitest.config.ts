import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../frontend/lib", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
