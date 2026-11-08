import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem } from "@platform/db";
import { auditLogs, authAccounts, authUsers, breakglassGrants, dataRequests, notifications, orders, systemSettings } from "@platform/db/schema";
import {
  getIntegrationSettings,
  listUsers,
  openBreakglass,
  publishContent,
  publishedContent,
  revokeBreakglass,
  saveContentDraft,
  saveIntegrationSetting,
  setOrgStatus,
  setUserStatus,
  testIntegration,
} from "../src/admin";
import { resolveContext } from "../src/context";
import { listRfqs } from "../src/rfq";
import { createProject } from "../src/projects";
import { buildExport, decideDeletion, myPrivacy, requestDeletion, requestExport, setConsent } from "../src/privacy";
import { adminCtx, createUser, ctxFor, rawAsApp, setupOrg } from "./helpers";
import { customer } from "./store-helpers";

describe("admin: users, organizations, break-glass, settings, content", () => {
  it("suspends users (sessions revoked, context refused) and protects the last admin", async () => {
    const admin = await adminCtx();
    const u = await createUser();
    await setUserStatus(admin, u.id, "suspended", "fraud investigation");
    await expect(resolveContext({ userId: u.id })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const notes = await withSystem((tx) => tx.select().from(notifications).where(eq(notifications.userId, u.id)));
    expect(notes.map((n) => n.kind)).toContain("account.status_changed");
    await setUserStatus(admin, u.id, "active", "cleared");
    expect((await resolveContext({ userId: u.id })).userId).toBe(u.id);
    await expect(setUserStatus(admin, admin.userId!, "suspended", "oops")).rejects.toMatchObject({ messageKey: "self_action" });
    const listed = await listUsers(admin, { q: u.email });
    expect(listed.items[0]!.u.email).toBe(u.email);
    // non-admins cannot use admin services
    const plain = await ctxFor(u.id);
    await expect(listUsers(plain)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("suspending an organization removes its members' org permissions", async () => {
    const admin = await adminCtx();
    const b = await setupOrg("buyer");
    await setOrgStatus(admin, b.org.id, "suspended", "unpaid subscription");
    const ctx = await ctxFor(b.user.id, b.org.id);
    expect(ctx.orgId).toBeNull();
    await setOrgStatus(admin, b.org.id, "active", "resolved");
    expect((await ctxFor(b.user.id, b.org.id)).orgId).toBe(b.org.id);
  });

  it("break-glass: reasoned, time-boxed, read-only, audited, owners notified, revocable", async () => {
    const admin = await adminCtx();
    const b = await setupOrg("buyer");
    await createProject(b.ctx, { name: "Confidential tower", projectType: "commercial" });
    // without a grant the admin has no access to the organization
    const before = await resolveContext({ userId: admin.userId!, orgId: b.org.id });
    expect(before.orgId).toBeNull();
    await expect(openBreakglass(admin, { orgId: b.org.id, reason: "short", minutes: 30 })).rejects.toBeTruthy();
    const g = await openBreakglass(admin, { orgId: b.org.id, reason: "Customer support ticket #4411 — data correction check", minutes: 30 });
    const bg = await resolveContext({ userId: admin.userId!, orgId: b.org.id });
    expect(bg.breakglass).toBe(true);
    expect(bg.orgId).toBe(b.org.id);
    // read works, write is refused
    await expect(listRfqs(bg)).resolves.toBeDefined();
    await expect(createProject(bg, { name: "should fail", projectType: "commercial" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ownerNotes = await withSystem((tx) => tx.select().from(notifications).where(sql`${notifications.userId} = ${b.user.id} and ${notifications.kind} = 'breakglass.opened'`));
    expect(ownerNotes).toHaveLength(1);
    const logs = await withSystem((tx) => tx.select().from(auditLogs).where(sql`${auditLogs.action} = 'breakglass.opened' and ${auditLogs.orgId} = ${b.org.id}`));
    expect(logs).toHaveLength(1);
    await revokeBreakglass(admin, g.id);
    expect((await resolveContext({ userId: admin.userId!, orgId: b.org.id })).orgId).toBeNull();
    // expired grants give nothing
    await withSystem((tx) => tx.insert(breakglassGrants).values({ adminUserId: admin.userId!, orgId: b.org.id, reason: "expired grant for test purposes", expiresAt: new Date(Date.now() - 1000) }));
    expect((await resolveContext({ userId: admin.userId!, orgId: b.org.id })).orgId).toBeNull();
  });

  it("stores integration secrets encrypted and never returns them", async () => {
    const admin = await adminCtx();
    await saveIntegrationSetting(admin, "smtp", { host: "smtp.example.test", port: 587, user: "mailer", from: "no-reply@example.test", secure: false }, "super-secret-pass");
    const s = await getIntegrationSettings(admin);
    expect(s.smtp.hasSecret).toBe(true);
    expect(JSON.stringify(s)).not.toContain("super-secret-pass");
    const [row] = await withSystem((tx) => tx.select().from(systemSettings).where(eq(systemSettings.key, "smtp")));
    expect(row!.secretEnc).toBeTruthy();
    expect(row!.secretEnc).not.toContain("super-secret-pass");
    // settings are validated
    await expect(saveIntegrationSetting(admin, "payments.bank_transfer", { enabled: true })).rejects.toMatchObject({ messageKey: "bank_details_required" });
    await expect(saveIntegrationSetting(admin, "payments.bank_transfer", { enabled: true, iban: "DE123", beneficiary: "X" })).rejects.toBeTruthy();
    await saveIntegrationSetting(admin, "payments.bank_transfer", { enabled: true, bankName: "Test Bank", iban: "SA0380000000608010167519", beneficiary: "Demo Trading" });
    expect((await testIntegration(admin, "payments")).ok).toBe(true);
    // the in-memory test transport is used in tests; the check runs and is audited
    const r = await testIntegration(admin, "smtp");
    expect(r).toHaveProperty("ok");
    await saveIntegrationSetting(admin, "smtp", { host: "", from: "" }, "");
    await saveIntegrationSetting(admin, "payments.bank_transfer", { enabled: false });
  });

  it("versions content pages; only published versions are public", async () => {
    const admin = await adminCtx();
    const d = await saveContentDraft(admin, { slug: "returns", locale: "en", title: "Returns policy", body: "Draft text pending legal review." });
    expect(await rawAsApp({ userId: null, orgId: null, mode: "public" }, "select id from content_pages where id = $1", [d.id])).toHaveLength(0);
    await publishContent(admin, d.id);
    expect((await publishedContent("returns", "en"))!.id).toBe(d.id);
    const d2 = await saveContentDraft(admin, { slug: "returns", locale: "en", title: "Returns policy v2", body: "Second draft text pending legal review." });
    await publishContent(admin, d2.id);
    expect((await publishedContent("returns", "en"))!.version).toBe(d2.version);
  });
});

describe("privacy (PDPL): consents, export, deletion", () => {
  it("records consents, exports personal data privately, and anonymizes on approved deletion", async () => {
    const admin = await adminCtx();
    const c = await customer();
    await setConsent(c.ctx, "marketing", true);
    await setConsent(c.ctx, "marketing", false);
    const p = await myPrivacy(c.ctx);
    expect(p.consents.find((x) => x.kind === "marketing")!.granted).toBe(false);
    expect(p.consents.map((x) => x.kind)).toEqual(expect.arrayContaining(["marketing"]));

    const r = await requestExport(c.ctx);
    await expect(requestExport(c.ctx)).rejects.toMatchObject({ messageKey: "request_open" });
    expect(await buildExport(r.id)).toBe("completed");
    const [done] = await withSystem((tx) => tx.select().from(dataRequests).where(eq(dataRequests.id, r.id)));
    expect(done!.status).toBe("completed");
    // only the owner can see the export file
    expect(await rawAsApp({ userId: c.user.id, orgId: null }, "select id from files where id = $1", [done!.resultFileId])).toHaveLength(1);
    const other = await createUser();
    expect(await rawAsApp({ userId: other.id, orgId: null }, "select id from files where id = $1", [done!.resultFileId])).toHaveLength(0);

    // deletion: rejected first, then approved → anonymized, login methods removed, orders retained
    const d1 = await requestDeletion(c.ctx, "please delete");
    await decideDeletion(admin, d1.id, "reject", "Open legal hold — test");
    const d2 = await requestDeletion(c.ctx, "again");
    await withSystem((tx) => tx.insert(orders).values({ code: `ORD-T-${d2.id.slice(-6)}`, userId: c.user.id, paymentMethod: "card", goodsNet: "10.00", shippingNet: "0.00", vatTotal: "1.50", total: "11.50", shippingAddress: {}, idempotencyKey: d2.id, status: "completed", paymentStatus: "paid" }));
    await decideDeletion(admin, d2.id, "approve", "Verified identity; no legal hold");
    const [u] = await withSystem((tx) => tx.select().from(authUsers).where(eq(authUsers.id, c.user.id)));
    expect(u!.status).toBe("deleted");
    expect(u!.email).toMatch(/^deleted-.*@deleted\.invalid$/);
    expect(u!.name).toBe("Deleted user");
    expect(await withSystem((tx) => tx.select().from(authAccounts).where(eq(authAccounts.userId, c.user.id)))).toHaveLength(0);
    expect(await withSystem((tx) => tx.select().from(orders).where(eq(orders.userId, c.user.id)))).toHaveLength(1);
    await expect(resolveContext({ userId: c.user.id })).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
