/**
 * Engineering hardening (P0 procurement): reproduction + regression tests for
 *   AUD-005 duplicate poItemId lines, AUD-006 PO cancellation vs shipment race.
 * See docs/HARDENING_REPORT.md.
 */
import { describe, expect, it } from "vitest";
import pg from "pg";
import { eq } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withSystem } from "@platform/db";
import { goodsReceipts, poItems, purchaseOrders, shipmentItems, shipments } from "@platform/db/schema";
import { acknowledgePo, cancelPo, completePo, createShipment, recordReceipt } from "../src/purchase-orders";
import { approvedSupplier, setupOrg } from "./helpers";

/** An approved PO with `lines` items of `qty` units, inserted directly (the approval flow is covered elsewhere). */
let parties: Promise<{ buyer: Awaited<ReturnType<typeof setupOrg>>; sup: Awaited<ReturnType<typeof approvedSupplier>> }> | undefined;
/** One buyer and one supplier for the whole file: approved suppliers are global state other suites rank against. */
const sharedParties = () => (parties ??= (async () => ({ buyer: await setupOrg("buyer"), sup: await approvedSupplier() }))());

async function approvedPo(lines = 2, qty = "100", own = false) {
  const { buyer, sup } = own ? { buyer: await setupOrg("buyer"), sup: await approvedSupplier() } : await sharedParties();
  const [po] = await withSystem((tx) =>
    tx
      .insert(purchaseOrders)
      .values({ orgId: buyer.org.id, supplierOrgId: sup.org.id, code: `PO-${randomToken(6)}`, approvalStatus: "approved", verificationCode: randomToken(12), issuedAt: new Date(), createdBy: buyer.user.id })
      .returning(),
  );
  const items = await withSystem((tx) =>
    tx
      .insert(poItems)
      .values(Array.from({ length: lines }, (_, n) => ({ poId: po!.id, orgId: buyer.org.id, supplierOrgId: sup.org.id, lineNo: n + 1, description: `Item ${n + 1}`, quantity: qty, unit: "pc", unitPrice: "10", lineNet: "1000", lineVat: "150", lineTotal: "1150" })))
      .returning(),
  );
  return { buyer, sup, po: po!, items: items.sort((a, b) => a.lineNo - b.lineNo) };
}

const itemRow = async (id: string) => (await withSystem((tx) => tx.select().from(poItems).where(eq(poItems.id, id))))[0]!;
const poRow = async (id: string) => (await withSystem((tx) => tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id))))[0]!;
const shipmentCount = async (poId: string) => (await withSystem((tx) => tx.select().from(shipments).where(eq(shipments.poId, poId)))).length;

describe("AUD-005: duplicate poItemId lines in a shipment or receipt", () => {
  it("rejects a shipment that repeats a PO line with a validation error and leaves no trace", async () => {
    const t = await approvedPo();
    const it0 = t.items[0]!;
    // 60 + 60 > 100 ordered: the combined quantity must be judged, not each line on its own
    await expect(createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: it0.id, quantity: "60" }, { poItemId: it0.id, quantity: "60" }] })).rejects.toMatchObject({ code: "VALIDATION", messageKey: "duplicate_line" });
    // even when the sum would fit, a repeated line is ambiguous input and is refused
    await expect(createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: it0.id, quantity: "10" }, { poItemId: it0.id, quantity: "10" }] })).rejects.toMatchObject({ messageKey: "duplicate_line" });
    expect(await shipmentCount(t.po.id)).toBe(0);
    expect((await itemRow(it0.id)).shippedQty).toBe("0.0000");
    expect((await poRow(t.po.id)).fulfillmentStatus).toBe("not_started");
  });

  it("still accepts a normal multi-line shipment, and zero-quantity repeats are ignored as before", async () => {
    const t = await approvedPo();
    const [a, b] = t.items as [(typeof t.items)[0], (typeof t.items)[0]];
    await createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: a.id, quantity: "40" }, { poItemId: b.id, quantity: "25" }, { poItemId: a.id, quantity: "0" }] });
    expect((await itemRow(a.id)).shippedQty).toBe("40.0000");
    expect((await itemRow(b.id)).shippedQty).toBe("25.0000");
    await expect(createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: a.id, quantity: "61" }] })).rejects.toMatchObject({ messageKey: "shipment_qty_exceeds" });
  });

  it("rejects a receipt that repeats a PO line (received + rejected judged together) with no side effects", async () => {
    const t = await approvedPo();
    const a = t.items[0]!;
    await createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: a.id, quantity: "50" }] });
    await expect(
      recordReceipt(t.buyer.ctx, t.po.id, { items: [{ poItemId: a.id, received: "30", rejected: "0" }, { poItemId: a.id, received: "30", rejected: "0" }] }),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey: "duplicate_line" });
    expect(await withSystem((tx) => tx.select().from(goodsReceipts).where(eq(goodsReceipts.poId, t.po.id)))).toHaveLength(0);
    const row = await itemRow(a.id);
    expect([row.receivedQty, row.rejectedQty]).toEqual(["0.0000", "0.0000"]);
    // a single combined line still works
    await recordReceipt(t.buyer.ctx, t.po.id, { items: [{ poItemId: a.id, received: "45", rejected: "5" }] });
    expect((await itemRow(a.id)).receivedQty).toBe("45.0000");
  });

  it("two simultaneous shipments cannot together exceed the ordered quantity", async () => {
    const t = await approvedPo(1, "100");
    const a = t.items[0]!;
    const res = await Promise.allSettled([createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: a.id, quantity: "60" }] }), createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: a.id, quantity: "60" }] })]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(res.find((r) => r.status === "rejected")).toMatchObject({ reason: { messageKey: "shipment_qty_exceeds" } });
    expect((await itemRow(a.id)).shippedQty).toBe("60.0000");
  });

  it("rejects a receipt that points at another PO's shipment", async () => {
    const t = await approvedPo();
    const other = await approvedPo();
    await createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: t.items[0]!.id, quantity: "10" }] });
    const [foreign] = await withSystem(async (tx) => {
      const [s] = await tx.insert(shipments).values({ poId: other.po.id, orgId: other.buyer.org.id, supplierOrgId: other.sup.org.id, reference: `X-${randomToken(4)}` }).returning();
      await tx.insert(shipmentItems).values({ shipmentId: s!.id, poItemId: other.items[0]!.id, orgId: other.buyer.org.id, supplierOrgId: other.sup.org.id, quantity: "1" });
      return [s!];
    });
    await expect(recordReceipt(t.buyer.ctx, t.po.id, { shipmentId: foreign.id, items: [{ poItemId: t.items[0]!.id, received: "5", rejected: "0" }] })).rejects.toMatchObject({ messageKey: "shipment_not_in_po" });
    expect(await withSystem((tx) => tx.select().from(goodsReceipts).where(eq(goodsReceipts.poId, t.po.id)))).toHaveLength(0);
  });
});

describe("AUD-006: cancelling a PO while the supplier registers a shipment", () => {
  /** Hold a row lock on the PO's items from another connection to freeze createShipment mid-flight. */
  async function holdItemLocks(poId: string) {
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    await c.connect();
    await c.query("BEGIN");
    await c.query("select 1 from po_items where po_id = $1 for update", [poId]);
    return {
      release: async () => {
        await c.query("COMMIT");
        await c.end();
      },
    };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("never yields a cancelled PO that has shipments (shipment already past its status check when the cancel lands)", async () => {
    const t = await approvedPo();
    const lock = await holdItemLocks(t.po.id);
    const ship = createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: t.items[0]!.id, quantity: "10" }] }).then(
      (v) => ({ ok: true as const, v }),
      (e) => ({ ok: false as const, e }),
    );
    await sleep(400); // createShipment has loaded the PO and is waiting on the item locks
    const cancel = cancelPo(t.buyer.ctx, t.po.id, "no longer needed").then(
      () => ({ ok: true as const }),
      (e) => ({ ok: false as const, e }),
    );
    await sleep(400);
    await lock.release();
    const [s, c] = await Promise.all([ship, cancel]);

    const po = await poRow(t.po.id);
    const shipped = await shipmentCount(t.po.id);
    expect(!(po.approvalStatus === "cancelled" && shipped > 0)).toBe(true);
    // exactly one side won, and the loser got a clean business error
    expect(Number(s.ok) + Number(c.ok)).toBe(1);
    if (!c.ok) expect(c.e).toMatchObject({ messageKey: "po_has_shipments" });
    if (!s.ok) expect(s.e).toMatchObject({ messageKey: "po_closed" });
    expect(po.fulfillmentStatus === "cancelled").toBe(po.approvalStatus === "cancelled");
  });

  it("a shipment attempted after the cancel committed is refused", async () => {
    const t = await approvedPo();
    await cancelPo(t.buyer.ctx, t.po.id, "cancelled by buyer");
    // supplier can no longer even see the PO as active; cancelled POs are closed for fulfilment
    await expect(createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: t.items[0]!.id, quantity: "1" }] })).rejects.toMatchObject({ messageKey: expect.stringMatching(/po_closed|not_found/) });
    expect(await shipmentCount(t.po.id)).toBe(0);
  });

  it("stress: cancel and ship racing on fresh POs always leave a consistent state", async () => {
    for (let round = 0; round < 12; round++) {
      const t = await approvedPo(1, "10");
      const [s, c] = await Promise.allSettled([
        createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: t.items[0]!.id, quantity: "5" }] }),
        cancelPo(t.buyer.ctx, t.po.id, "race round"),
      ]);
      const po = await poRow(t.po.id);
      const shipped = await shipmentCount(t.po.id);
      expect(po.approvalStatus === "cancelled" && shipped > 0, `round ${round}`).toBe(false);
      expect(s.status === "fulfilled" || c.status === "fulfilled", `round ${round}`).toBe(true);
      expect(s.status === "fulfilled" && c.status === "fulfilled", `round ${round}`).toBe(false);
      expect(shipped === (s.status === "fulfilled" ? 1 : 0), `round ${round}`).toBe(true);
    }
  });

  it("acknowledging a PO that was just cancelled does not resurrect its fulfilment status", async () => {
    const t = await approvedPo();
    // acknowledge only touches the PO row: freeze it by holding the PO row lock from another connection
    const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    await c.connect();
    await c.query("BEGIN");
    await c.query("select 1 from purchase_orders where id = $1 for update", [t.po.id]);
    const ack = acknowledgePo(t.sup.ctx, t.po.id).then(() => ({ ok: true }), (e) => ({ ok: false, e }));
    await sleep(300);
    await c.query("update purchase_orders set approval_status = 'cancelled', fulfillment_status = 'cancelled' where id = $1", [t.po.id]);
    await c.query("COMMIT");
    await c.end();
    await ack;
    const po = await poRow(t.po.id);
    expect(po.approvalStatus).toBe("cancelled");
    expect(po.fulfillmentStatus).toBe("cancelled");
  });

  it("receiving and completing remain consistent with shipments (regression)", async () => {
    const t = await approvedPo(1, "10");
    const a = t.items[0]!;
    await createShipment(t.sup.ctx, t.po.id, { items: [{ poItemId: a.id, quantity: "10" }] });
    await expect(cancelPo(t.buyer.ctx, t.po.id, "too late")).rejects.toMatchObject({ messageKey: "po_has_shipments" });
    await recordReceipt(t.buyer.ctx, t.po.id, { items: [{ poItemId: a.id, received: "10", rejected: "0" }] });
    expect((await poRow(t.po.id)).fulfillmentStatus).toBe("delivered");
    await completePo(t.buyer.ctx, t.po.id);
    expect((await poRow(t.po.id)).fulfillmentStatus).toBe("completed");
  });
});
