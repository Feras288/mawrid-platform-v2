import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { notificationDeliveries, purchaseOrders, rfqRecipients } from "@platform/db/schema";
import { getEmailTransport, MemoryTransport } from "@platform/integrations/email";
import { setPdfRenderer } from "@platform/integrations/pdf";
import { decide, getRequest, listRequests, savePolicy } from "../src/approvals";
import { getAward, selectAward, setEvaluation, submitAward } from "../src/evaluation";
import { acceptInvitation, inviteMember, listAssignableRoles } from "../src/organizations";
import { sendDelivery } from "../src/notifications";
import { createProduct } from "../src/supplier-products";
import { acknowledgePo, completePo, createFromAward, createShipment, generatePoDocuments, getPo, listPos, recordReceipt, submitPo, verifyPo } from "../src/purchase-orders";
import { comparison, getMyQuotation, reviseQuotation, saveQuotation, submitQuotation } from "../src/quotations";
import { closeSubmissions, createRfq, deliverRecipient, getRfq, getRfqForSupplier, sendRfq, setRecipients, submitRfq, suggestSuppliers, supplierInbox, addRfqItem } from "../src/rfq";
import { approvedSupplier, categoryBySlug, createUser, ctxFor, rawAsApp, setupOrg } from "./helpers";

beforeAll(() => setPdfRenderer({ render: async (html) => Buffer.from(`%PDF-fake ${html.length}`) }));
afterAll(() => setPdfRenderer(undefined));

const future = (days: number) => new Date(Date.now() + days * 86400_000);

async function addMember(ownerCtx: Awaited<ReturnType<typeof setupOrg>>["ctx"], roleKey: string) {
  const role = (await listAssignableRoles(ownerCtx)).find((r) => r.key === roleKey)!;
  const u = await createUser();
  const { token } = await inviteMember(ownerCtx, { email: u.email, roleIds: [role.id] });
  await acceptInvitation(await ctxFor(u.id), token);
  return ctxFor(u.id, ownerCtx.orgId);
}

describe("B2B procurement cycle: RFQ → quotations → evaluation → approvals → PO → delivery", () => {
  it("runs the whole cycle with isolation, approvals, SoD and no duplicates", async () => {
    // ---- parties
    const buyer = await setupOrg("buyer");
    const officer = await addMember(buyer.ctx, "procurement_officer");
    const manager = await addMember(buyer.ctx, "procurement_manager");
    const approver = await addMember(buyer.ctx, "approver");
    const s1 = await approvedSupplier();
    const s2 = await approvedSupplier();
    const s3 = await approvedSupplier(); // invited competitor who does not quote
    const pipes = await categoryBySlug("pipes");
    await createProduct(s1.ctx, { sku: `S1-${randomToken(4)}`, categoryId: pipes.id, nameAr: "ماسورة", nameEn: "Pipe", saleUnit: "m", attributes: { material: "upvc", diameter_mm: 110 }, status: "active" });

    // ---- approval policies: award > 10,000 needs manager then approver (sequential); PO issue needs approver
    await savePolicy(buyer.ctx, null, { name: "Award", operation: "award", minAmount: "0", steps: [{ stepOrder: 1, name: "Procurement manager", requiredRoleKey: "procurement_manager" }, { stepOrder: 2, name: "Approver", requiredRoleKey: "approver" }] });
    await savePolicy(buyer.ctx, null, { name: "PO", operation: "po_issue", steps: [{ stepOrder: 1, name: "Approver", requiredRoleKey: "approver" }] });

    // ---- RFQ (manual lines)
    const rfq = await createRfq(officer, { title: "Plumbing package", closesAt: future(5), deliveryCity: "riyadh", paymentTerms: "30 days" });
    const l1 = await addRfqItem(officer, rfq.id, { description: "uPVC pipe 110mm PN10", quantity: "100", unit: "m", categoryId: pipes.id });
    const l2 = await addRfqItem(officer, rfq.id, { description: "uPVC pipe 160mm", quantity: "50", unit: "m", categoryId: pipes.id });
    const sugg = await suggestSuppliers(officer, rfq.id);
    expect(sugg.find((x) => x.orgId === s1.org.id)?.reasons).toContain("category_coverage");
    await setRecipients(officer, rfq.id, [s1.org.id, s2.org.id, s3.org.id]);
    await expect(sendRfq(officer, rfq.id, randomToken(10))).rejects.toMatchObject({ code: "FORBIDDEN" }); // officer lacks rfq.send
    const sub = await submitRfq(officer, rfq.id);
    expect(sub.status).toBe("auto_approved"); // no rfq_send policy configured

    // suppliers cannot see the RFQ before it is sent
    expect(await rawAsApp({ userId: s1.user.id, orgId: s1.org.id }, "select id from rfqs where id = $1", [rfq.id])).toHaveLength(0);

    // ---- send (idempotent)
    const key = randomToken(12);
    const sent1 = await sendRfq(manager, rfq.id, key);
    const sent2 = await sendRfq(manager, rfq.id, key);
    expect(sent1).toEqual(sent2);
    expect(sent1.recipients).toBe(3);
    const recips = await withSystem((tx) => tx.select().from(rfqRecipients).where(eq(rfqRecipients.rfqId, rfq.id)));
    for (const r of recips) expect(await deliverRecipient(r.id)).toBe("sent");
    for (const r of recips) expect(await deliverRecipient(r.id)).toBe("noop"); // never re-sent
    const after = await getRfq(manager, rfq.id);
    expect(after.rfq.status).toBe("open");
    // invitation emails queued once per supplier user
    const deliveries = await withSystem((tx) => tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.template, "rfq.invitation")));
    expect(deliveries.filter((d) => recips.some((r) => d.dedupeKey.startsWith(`rfq-invite:${r.id}`)))).toHaveLength(3);

    // ---- supplier sees only its own recipient row & the RFQ
    const inbox = await supplierInbox(s1.ctx);
    expect(inbox.items.some((i) => i.rfq.id === rfq.id)).toBe(true);
    const sv = await getRfqForSupplier(s1.ctx, rfq.id);
    expect(sv.items).toHaveLength(2);
    expect(await rawAsApp({ userId: s1.user.id, orgId: s1.org.id }, "select supplier_org_id from rfq_recipients where rfq_id = $1", [rfq.id])).toEqual([{ supplier_org_id: s1.org.id }]);

    // ---- quotations: s1 quotes both lines, s2 only line 1 (cheaper) with an alternative note
    await saveQuotation(s1.ctx, rfq.id, {
      validUntil: future(30),
      leadTimeDays: 7,
      shippingAmount: "100",
      paymentTerms: "30 days",
      lines: [
        { rfqItemId: l1.id, offered: true, unitPrice: "20", quantity: "100", discountPct: 0, vatRate: "0.15", isAlternative: false },
        { rfqItemId: l2.id, offered: true, unitPrice: "40", quantity: "50", discountPct: 10, vatRate: "0.15", isAlternative: false },
      ],
    });
    await expect(saveQuotation(s1.ctx, rfq.id, { lines: [{ rfqItemId: l1.id, offered: true, unitPrice: "1", quantity: "999", discountPct: 0, vatRate: "0.15", isAlternative: false }] })).rejects.toMatchObject({ messageKey: "quote_qty_exceeds" });
    const q1 = await submitQuotation(s1.ctx, rfq.id);
    expect(q1.total).toBe("4485.00"); // (2000 + 1800 net) * 1.15 + shipping 100 * 1.15
    await saveQuotation(s2.ctx, rfq.id, {
      validUntil: future(30),
      lines: [
        { rfqItemId: l1.id, offered: true, unitPrice: "18.5", quantity: "100", discountPct: 0, vatRate: "0.15", isAlternative: true, alternativeDescription: "Equivalent brand X", exceptionNote: "Delivery in 2 batches" },
        { rfqItemId: l2.id, offered: false, discountPct: 0, vatRate: "0.15", isAlternative: false },
      ],
    });
    await submitQuotation(s2.ctx, rfq.id);
    // s2 revises (version 2 supersedes version 1)
    await reviseQuotation(s2.ctx, rfq.id);
    await saveQuotation(s2.ctx, rfq.id, { validUntil: future(30), lines: [{ rfqItemId: l1.id, offered: true, unitPrice: "18", quantity: "100", discountPct: 0, vatRate: "0.15", isAlternative: true, alternativeDescription: "Equivalent brand X" }] });
    const q2v2 = await submitQuotation(s2.ctx, rfq.id);
    expect(q2v2.version).toBe(2);

    // ---- competitor isolation: s1 cannot read s2's quotation (service + raw SQL), s3 neither
    expect(await rawAsApp({ userId: s1.user.id, orgId: s1.org.id }, "select id from quotations where rfq_id = $1 and supplier_org_id = $2", [rfq.id, s2.org.id])).toHaveLength(0);
    expect(await rawAsApp({ userId: s3.user.id, orgId: s3.org.id }, "select id from quotation_items where buyer_org_id = $1", [buyer.org.id])).toHaveLength(0);
    expect((await getMyQuotation(s1.ctx, rfq.id))!.quotation.supplierOrgId).toBe(s1.org.id);
    // another buyer org cannot read anything
    const other = await setupOrg("buyer");
    expect(await rawAsApp({ userId: other.user.id, orgId: other.org.id }, "select id from quotations where rfq_id = $1", [rfq.id])).toHaveLength(0);
    expect(await rawAsApp({ userId: other.user.id, orgId: other.org.id }, "select id from rfqs where id = $1", [rfq.id])).toHaveLength(0);

    // ---- comparison matrix
    await closeSubmissions(manager, rfq.id);
    const cmp = await comparison(manager, rfq.id);
    expect(cmp.suppliers).toHaveLength(2);
    const row1 = cmp.rows.find((r) => r.line.id === l1.id)!;
    expect(row1.cells[s2.org.id]!.lowestPrice).toBe(true);
    expect(row1.cells[s2.org.id]!.isAlternative).toBe(true);
    expect(row1.minUnitPrice).toBe("18.0000");
    const row2 = cmp.rows.find((r) => r.line.id === l2.id)!;
    expect(row2.cells[s1.org.id]!.unitPrice).toBe("36.0000"); // 40 less 10%
    expect(row2.offers).toBe(1);
    expect(cmp.suppliers.find((x) => x.supplierOrgId === s1.org.id)!.bestCoverage).toBe(true);

    // ---- evaluation: non-compliant offers cannot be awarded
    await setEvaluation(manager, rfq.id, { rfqItemId: l1.id, supplierOrgId: s2.org.id, technicalStatus: "non_compliant", technicalNote: "Brand not approved" });
    await expect(selectAward(manager, rfq.id, { rfqItemId: l1.id, supplierOrgId: s2.org.id, reason: "cheapest" })).rejects.toMatchObject({ messageKey: "award_non_compliant" });
    await setEvaluation(manager, rfq.id, { rfqItemId: l1.id, supplierOrgId: s2.org.id, technicalStatus: "compliant", technicalNote: "Approved after clarification" });
    // split award: line 1 → s2, line 2 → s1
    await selectAward(manager, rfq.id, { rfqItemId: l1.id, supplierOrgId: s2.org.id, reason: "Lowest compliant price" });
    await selectAward(manager, rfq.id, { rfqItemId: l2.id, supplierOrgId: s1.org.id, reason: "Only offer" });
    const sa = await submitAward(manager, rfq.id, "Split award");
    expect(sa.status).toBe("pending");

    // ---- approvals: requester cannot approve; sequential steps; approver can only act on step 2
    const reqs = await listRequests(manager, { status: "pending" });
    const awardReq = reqs.items.find((r) => r.subjectType === "award")!;
    await expect(decide(manager, awardReq.id, { decision: "approve" })).rejects.toMatchObject({ messageKey: "sod_requester" });
    await expect(decide(approver, awardReq.id, { decision: "approve" })).rejects.toMatchObject({ messageKey: "not_approver" });
    const manager2 = await addMember(buyer.ctx, "procurement_manager");
    expect((await decide(manager2, awardReq.id, { decision: "approve", comment: "ok" })).outcome).toBe("pending");
    expect((await decide(approver, awardReq.id, { decision: "approve" })).outcome).toBe("approved");
    const detail = await getRequest(manager, awardReq.id);
    expect(detail.decisions).toHaveLength(2);
    const aw = await getAward(manager, rfq.id);
    expect(aw.award!.status).toBe("approved");
    expect((await getRfq(manager, rfq.id)).rfq.status).toBe("awarded");

    // ---- POs: one per supplier, idempotent and unique
    const k = randomToken(12);
    const created = await createFromAward(manager, rfq.id, k);
    expect(created.created).toHaveLength(2);
    expect(await createFromAward(manager, rfq.id, k)).toEqual(created);
    expect((await createFromAward(manager, rfq.id, randomToken(12))).created).toHaveLength(0); // unique (award, supplier)
    const pos = await listPos(manager, { side: "buyer", rfqId: rfq.id });
    expect(pos.total).toBe(2);
    const poS2 = pos.items.find((p) => p.po.supplierOrgId === s2.org.id)!.po;
    expect(poS2.total).toBe("2070.00"); // 100 * 18 * 1.15
    // supplier cannot see the PO before it is issued
    expect(await rawAsApp({ userId: s2.user.id, orgId: s2.org.id }, "select id from purchase_orders where id = $1", [poS2.id])).toHaveLength(0);

    await submitPo(manager, poS2.id);
    const poReq = (await listRequests(approver, { scope: "mine" })).items.find((r) => r.subjectId === poS2.id)!;
    await expect(decide(approver, poReq.id, { decision: "reject" })).rejects.toMatchObject({ messageKey: "reason_required" });
    expect((await decide(approver, poReq.id, { decision: "approve" })).outcome).toBe("approved");
    const issued = await getPo(manager, poS2.id);
    expect(issued.po.approvalStatus).toBe("approved");
    await generatePoDocuments(poS2.id);
    const [withPdf] = await withSystem((tx) => tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, poS2.id)));
    expect(withPdf!.pdfFileIdAr).toBeTruthy();
    expect(withPdf!.pdfFileIdEn).toBeTruthy();
    // supplier can now read it and its PDF; the other supplier cannot
    expect(await rawAsApp({ userId: s2.user.id, orgId: s2.org.id }, "select id from purchase_orders where id = $1", [poS2.id])).toHaveLength(1);
    expect(await rawAsApp({ userId: s2.user.id, orgId: s2.org.id }, "select id from files where id = $1", [withPdf!.pdfFileIdAr])).toHaveLength(1);
    expect(await rawAsApp({ userId: s1.user.id, orgId: s1.org.id }, "select id from purchase_orders where id = $1", [poS2.id])).toHaveLength(0);
    const ver = await verifyPo(withPdf!.verificationCode);
    expect(ver?.code).toBe(poS2.code);

    // ---- fulfilment: ack, partial shipment, partial receipt, rest, complete
    await acknowledgePo(s2.ctx, poS2.id);
    const items = (await getPo(s2.ctx, poS2.id)).items;
    await expect(createShipment(s2.ctx, poS2.id, { items: [{ poItemId: items[0]!.id, quantity: "150" }] })).rejects.toMatchObject({ messageKey: "shipment_qty_exceeds" });
    await createShipment(s2.ctx, poS2.id, { carrier: "SMSA", trackingNumber: "TRK1", items: [{ poItemId: items[0]!.id, quantity: "60" }] });
    expect((await getPo(manager, poS2.id)).po.fulfillmentStatus).toBe("partially_fulfilled");
    await expect(recordReceipt(manager, poS2.id, { items: [{ poItemId: items[0]!.id, received: "70", rejected: "0" }] })).rejects.toMatchObject({ messageKey: "receipt_exceeds_shipped" });
    await recordReceipt(manager, poS2.id, { items: [{ poItemId: items[0]!.id, received: "58", rejected: "2", note: "2 damaged" }] });
    expect((await getPo(manager, poS2.id)).po.fulfillmentStatus).toBe("partially_delivered");
    await createShipment(s2.ctx, poS2.id, { items: [{ poItemId: items[0]!.id, quantity: "40" }] });
    await recordReceipt(manager, poS2.id, { items: [{ poItemId: items[0]!.id, received: "40", rejected: "0" }] });
    // 98 received + 2 rejected of 100 → not fully delivered
    expect((await getPo(manager, poS2.id)).po.fulfillmentStatus).toBe("partially_delivered");
    await expect(completePo(manager, poS2.id)).rejects.toMatchObject({ messageKey: "po_not_delivered" });
    const timeline = (await getPo(manager, poS2.id)).events.map((e) => e.kind);
    expect(timeline).toEqual(expect.arrayContaining(["created", "issued", "acknowledged", "shipment_created", "goods_received"]));
    // supplier timeline hides buyer-internal events
    expect((await getPo(s2.ctx, poS2.id)).events.map((e) => e.kind)).not.toContain("submitted");

    // ---- KPIs and price observations are derived from the same records
    const { buyerKpis, supplierKpis } = await import("../src/analytics");
    const { collectObservations } = await import("../src/price-index");
    const sums = await withSystem((tx) =>
      tx.execute(sql`select coalesce(sum(total) filter (where org_id = ${manager.orgId}),0)::text as buyer, coalesce(sum(total) filter (where supplier_org_id = ${s2.org.id}),0)::text as sup
                     from purchase_orders where approval_status = 'approved' and fulfillment_status <> 'cancelled'`),
    );
    const totals = sums.rows[0] as { buyer: string; sup: string };
    const bk = await buyerKpis(manager);
    expect(bk.poValue).toBe(Number(totals.buyer).toFixed(2));
    expect(bk.rfqsSent).toBeGreaterThanOrEqual(1);
    expect(bk.responseRatePct).not.toBeNull();
    expect(bk.spendByMonth).toHaveLength(12);
    expect(bk.spendByMonth.at(-1)!.value).not.toBe("0.00");
    const sk = await supplierKpis(s2.ctx);
    expect(sk.poValue).toBe(Number(totals.sup).toFixed(2));
    expect(sk.winRatePct).not.toBeNull();
    await expect(buyerKpis(s2.ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const first = await collectObservations();
    const again = await collectObservations();
    expect(again.po ?? 0).toBe(0); // idempotent
    expect((first.po ?? 0) + (first.rfq_quote ?? 0) + (first.rfq_award ?? 0)).toBeGreaterThan(0);
  });

  it("email failures are retried and recorded without corrupting the RFQ", async () => {
    const t = getEmailTransport() as MemoryTransport;
    const buyer = await setupOrg("buyer");
    const s = await approvedSupplier();
    const rfq = await createRfq(buyer.ctx, { title: "Mail failure test", closesAt: future(3) });
    await addRfqItem(buyer.ctx, rfq.id, { description: "Item", quantity: "1", unit: "pc" });
    await setRecipients(buyer.ctx, rfq.id, [s.org.id]);
    await submitRfq(buyer.ctx, rfq.id);
    await sendRfq(buyer.ctx, rfq.id, randomToken(12));
    const [rc] = await withSystem((tx) => tx.select().from(rfqRecipients).where(eq(rfqRecipients.rfqId, rfq.id)));
    expect(await deliverRecipient(rc!.id)).toBe("sent");
    const [d] = await withSystem((tx) => tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.dedupeKey, `rfq-invite:${rc!.id}:1:${s.user.id}`)));
    t.failNext = 1;
    await expect(sendDelivery(d!.id)).rejects.toThrow("Simulated SMTP failure");
    const [afterFail] = await withSystem((tx) => tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, d!.id)));
    expect(afterFail).toMatchObject({ status: "pending", attempts: 1 });
    expect(await sendDelivery(d!.id)).toBe("sent");
    expect((await getRfq(buyer.ctx, rfq.id)).rfq.status).toBe("open");
  });

  it("changing an approved award invalidates its approval and reopens evaluation", async () => {
    const buyer = await setupOrg("buyer");
    const s = await approvedSupplier();
    const rfq = await createRfq(buyer.ctx, { title: "Invalidation", closesAt: future(3) });
    const l = await addRfqItem(buyer.ctx, rfq.id, { description: "Item", quantity: "10", unit: "pc" });
    await setRecipients(buyer.ctx, rfq.id, [s.org.id]);
    await submitRfq(buyer.ctx, rfq.id);
    await sendRfq(buyer.ctx, rfq.id, randomToken(12));
    const [rc] = await withSystem((tx) => tx.select().from(rfqRecipients).where(eq(rfqRecipients.rfqId, rfq.id)));
    await deliverRecipient(rc!.id);
    await saveQuotation(s.ctx, rfq.id, { validUntil: future(10), lines: [{ rfqItemId: l.id, offered: true, unitPrice: "5", quantity: "10", discountPct: 0, vatRate: "0.15", isAlternative: false }] });
    await submitQuotation(s.ctx, rfq.id);
    await closeSubmissions(buyer.ctx, rfq.id);
    await selectAward(buyer.ctx, rfq.id, { rfqItemId: l.id, supplierOrgId: s.org.id });
    expect((await submitAward(buyer.ctx, rfq.id)).status).toBe("auto_approved");
    expect((await getRfq(buyer.ctx, rfq.id)).rfq.status).toBe("awarded");
    await selectAward(buyer.ctx, rfq.id, { rfqItemId: l.id, supplierOrgId: s.org.id, quantity: "8", reason: "reduced" });
    const aw = await getAward(buyer.ctx, rfq.id);
    expect(aw.award!.status).toBe("draft");
    expect(aw.history.length).toBeGreaterThanOrEqual(2);
    expect((await getRfq(buyer.ctx, rfq.id)).rfq.status).toBe("under_evaluation");
  });
});
