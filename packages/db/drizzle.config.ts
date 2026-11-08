import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "postgres://platform_owner:owner_dev_password@localhost:5442/platform" },
  strict: true,
});
