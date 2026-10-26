import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [".github/scripts/**/*.test.{ts,tsx}", "{worker,web,shared,tests}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**"],
  },
});
