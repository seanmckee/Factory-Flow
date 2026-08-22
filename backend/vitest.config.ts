import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // no jsdom - everything under test here is pure and DB-free, matching how
    // the frontend runs the simulation engine
    environment: "node",
    // scoped to src so the compiled *.test.js under dist/ is never collected
    // as a second, stale copy of every suite
    include: ["src/**/*.test.ts"],
  },
});
