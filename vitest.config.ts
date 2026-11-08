import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/*/test/**/*.unit.test.ts", "apps/*/test/**/*.unit.test.ts"],
          environment: "node",
          env: { APP_ENV: "test" },
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/*/test/**/*.int.test.ts", "apps/*/test/**/*.int.test.ts"],
          environment: "node",
          globalSetup: ["./tests/setup/global-integration.ts"],
          setupFiles: ["./tests/setup/integration-env.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
