import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { AppError } from "@platform/core";
import { withSystem } from "@platform/db";
import { notificationDeliveries } from "@platform/db/schema";
import { getEmailTransport, MemoryTransport } from "@platform/integrations/email";
import { sendDelivery } from "../src/notifications";
import { acceptInvitation, createCustomRole, inviteMember, listAssignableRoles, listMembers, setMemberRoles, setMemberStatus, updateOrganization } from "../src/organizations";
import { createUser, ctxFor, setupOrg } from "./helpers";

describe("organizations & memberships", () => {
  it("creates an org with the creator as owner holding all buyer permissions", async () => {
    const { ctx, org } = await setupOrg("buyer");
    expect(ctx.orgId).toBe(org.id);
    expect(ctx.roleKeys).toContain("owner");
    expect(ctx.permissions.has("members.manage")).toBe(true);
    expect(ctx.permissions.has("supplier.quotation.submit")).toBe(false);
  });

  it("validates Saudi VAT format", async () => {
    const { ctx } = await setupOrg("buyer");
    await expect(updateOrganization(ctx, { vatNumber: "123" })).rejects.toThrow();
    const updated = await updateOrganization(ctx, { vatNumber: "300000000000003", city: "Riyadh" });
    expect(updated.vatNumber).toBe("300000000000003");
  });

  it("invites a member by email, sends email, and accepts with matching verified email", async () => {
    const { ctx } = await setupOrg("buyer");
    const roles = await listAssignableRoles(ctx);
    const officer = roles.find((r) => r.key === "procurement_officer")!;
    const invitee = await createUser();
    const { token, invitation } = await inviteMember(ctx, { email: invitee.email, roleIds: [officer.id] });
    const [d] = await withSystem((tx) => tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.dedupeKey, `invitation:${invitation.id}`)));
    expect(d).toBeDefined();
    expect(await sendDelivery(d!.id)).toBe("sent");
    expect(await sendDelivery(d!.id)).toBe("noop"); // never sent twice
    const t = getEmailTransport() as MemoryTransport;
    expect(t.sent.at(-1)!.to).toBe(invitee.email);
    expect(t.sent.at(-1)!.html).toContain(token);
    const [after] = await withSystem((tx) => tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, d!.id)));
    expect(JSON.stringify(after!.params)).not.toContain(token);

    const stranger = await createUser();
    await expect(acceptInvitation(await ctxFor(stranger.id), token)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const res = await acceptInvitation(await ctxFor(invitee.id), token);
    const ictx = await ctxFor(invitee.id, res.orgId);
    expect(ictx.roleKeys).toEqual(["procurement_officer"]);
    expect(ictx.permissions.has("rfq.create")).toBe(true);
    expect(ictx.permissions.has("members.manage")).toBe(false);
    await expect(acceptInvitation(await ctxFor(invitee.id), token)).rejects.toBeInstanceOf(AppError);
    expect(await listMembers(ctx)).toHaveLength(2);
  });

  it("prevents privilege escalation and last-owner removal", async () => {
    const { ctx, user } = await setupOrg("buyer");
    const roles = await listAssignableRoles(ctx);
    const owner = roles.find((r) => r.key === "owner")!;
    const viewer = roles.find((r) => r.key === "viewer")!;
    const me = (await listMembers(ctx)).find((m) => m.userId === user.id)!;
    await expect(setMemberRoles(ctx, me.membershipId, [viewer.id])).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(setMemberStatus(ctx, me.membershipId, "removed")).rejects.toMatchObject({ code: "CONFLICT" });

    const adminRole = roles.find((r) => r.key === "admin")!;
    const u2 = await createUser();
    const { token } = await inviteMember(ctx, { email: u2.email, roleIds: [adminRole.id] });
    const { orgId } = await acceptInvitation(await ctxFor(u2.id), token);
    const adminCtx = await ctxFor(u2.id, orgId);
    const self = (await listMembers(adminCtx)).find((m) => m.userId === u2.id)!;
    await expect(setMemberRoles(adminCtx, self.membershipId, [owner.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("custom roles cannot include permissions of another org type", async () => {
    const { ctx } = await setupOrg("buyer");
    await expect(createCustomRole(ctx, { nameAr: "دور", nameEn: "Role", permissions: ["supplier.po.fulfil"] })).rejects.toMatchObject({ code: "VALIDATION" });
    const r = await createCustomRole(ctx, { nameAr: "قارئ", nameEn: "Reader", permissions: ["rfq.view", "po.view"] });
    expect(r.orgId).toBe(ctx.orgId);
  });

  it("server-side authorization denies members lacking permission", async () => {
    const { ctx } = await setupOrg("buyer");
    const viewer = (await listAssignableRoles(ctx)).find((r) => r.key === "viewer")!;
    const u = await createUser();
    const { token } = await inviteMember(ctx, { email: u.email, roleIds: [viewer.id] });
    const { orgId } = await acceptInvitation(await ctxFor(u.id), token);
    const vctx = await ctxFor(u.id, orgId);
    await expect(updateOrganization(vctx, { city: "Jeddah" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not resolve an org context for non-members", async () => {
    const { org } = await setupOrg("buyer");
    const outsider = await createUser();
    const c = await ctxFor(outsider.id, org.id);
    expect(c.orgId).toBeNull();
    expect(c.permissions.size).toBe(0);
  });
});
