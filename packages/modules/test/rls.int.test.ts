import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withContext } from "@platform/db";
import { auditLogs, organizations } from "@platform/db/schema";
import { createUser, rawAsApp, setupOrg } from "./helpers";

/**
 * Database-level isolation: these tests connect as the runtime role `app_user` and run raw SQL, so
 * they verify the RLS policies themselves rather than application checks.
 */
describe("RLS isolation (raw SQL as app_user)", () => {
  it("app_user is not superuser and cannot bypass RLS", async () => {
    const rows = await rawAsApp<{ rolsuper: boolean; rolbypassrls: boolean }>({}, "select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("buyer org A cannot read buyer org B's row, memberships or audit logs", async () => {
    const a = await setupOrg("buyer");
    const b = await setupOrg("buyer");
    const ctxA = { userId: a.user.id, orgId: a.org.id };
    expect(await rawAsApp(ctxA, "select id from organizations where id = $1", [b.org.id])).toHaveLength(0);
    expect(await rawAsApp(ctxA, "select id from organizations where id = $1", [a.org.id])).toHaveLength(1);
    expect(await rawAsApp(ctxA, "select * from memberships where org_id = $1", [b.org.id])).toHaveLength(0);
    expect(await rawAsApp(ctxA, "select * from audit_logs where org_id = $1", [b.org.id])).toHaveLength(0);
    expect(await rawAsApp(ctxA, "select * from invitations where org_id = $1", [b.org.id])).toHaveLength(0);
  });

  it("a user without membership cannot see a buyer org", async () => {
    const b = await setupOrg("buyer");
    const outsider = await createUser();
    expect(await rawAsApp({ userId: outsider.id }, "select id from organizations where id = $1", [b.org.id])).toHaveLength(0);
  });

  it("cannot update or insert into another org by id", async () => {
    const a = await setupOrg("buyer");
    const b = await setupOrg("buyer");
    const ctxA = { userId: a.user.id, orgId: a.org.id };
    expect(await rawAsApp(ctxA, "update organizations set city = 'X' where id = $1 returning id", [b.org.id])).toHaveLength(0);
    await expect(rawAsApp(ctxA, "insert into memberships (id, org_id, user_id) values (gen_random_uuid(), $1, $2)", [b.org.id, a.user.id])).rejects.toThrow(/row-level security/);
  });

  it("supplier orgs are a public directory", async () => {
    const s = await setupOrg("supplier");
    expect(await rawAsApp({ mode: "public" }, "select id from organizations where id = $1", [s.org.id])).toHaveLength(1);
  });

  it("audit_logs are append-only for app_user", async () => {
    const a = await setupOrg("buyer");
    const ctxA = { userId: a.user.id, orgId: a.org.id };
    await expect(rawAsApp(ctxA, "delete from audit_logs where org_id = $1", [a.org.id])).rejects.toThrow(/permission denied/);
    await expect(rawAsApp(ctxA, "update audit_logs set action = 'x' where org_id = $1", [a.org.id])).rejects.toThrow(/permission denied/);
  });

  it("withContext enforces the same isolation through Drizzle", async () => {
    const a = await setupOrg("buyer");
    const b = await setupOrg("buyer");
    const c = { userId: a.user.id, orgId: a.org.id, mode: "user" as const };
    expect(await withContext(c, (tx) => tx.select().from(organizations).where(eq(organizations.id, b.org.id)))).toHaveLength(0);
    expect(await withContext(c, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.orgId, b.org.id)))).toHaveLength(0);
  });

  it("outbox events are invisible to user mode", async () => {
    const a = await setupOrg("buyer");
    expect(await rawAsApp({ userId: a.user.id, orgId: a.org.id }, "select * from outbox_events limit 5")).toHaveLength(0);
  });
});
