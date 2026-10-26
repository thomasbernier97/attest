import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [".github/scripts/**/*.test.ts", "{worker,web,shared,tests}/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
  },
});
