import "./load-env";
import { afterAll, beforeAll } from "vitest";

process.env.APP_ENV = "test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_OWNER_URL = process.env.TEST_DATABASE_OWNER_URL;
// tests use in-memory storage and email transports
delete process.env.S3_ENDPOINT;
delete process.env.S3_ACCESS_KEY;
process.env.LOG_LEVEL = "warn";

beforeAll(async () => {
  const { setEmailTransport, MemoryTransport } = await import("@platform/integrations/email");
  setEmailTransport(new MemoryTransport());
  const { syncSystemRoles } = await import("@platform/modules/organizations");
  await syncSystemRoles();
  const { syncReferenceData } = await import("@platform/modules/reference");
  await syncReferenceData();
});

afterAll(async () => {
  const { closeDb } = await import("@platform/db");
  await closeDb();
});
