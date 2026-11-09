/**
 * Wires outbox topics to queue jobs and queue jobs to module processors. Imported by the worker.
 * Keep handlers thin: they only enqueue; processors do the work and must be idempotent.
 */
import { processBoq } from "../boq";
import { flagDelays, generatePoDocuments } from "../purchase-orders";
import { closeDueRfqs, deliverRecipient, notifyCancelled } from "../rfq";
import "../evaluation";
import { on } from "../events";
import { processProductImport } from "../imports";
import { registerProcessor } from "../jobs";
import { syncReferenceData } from "../reference";
import { expireDocuments } from "../suppliers";
import { completeDeliveredGroups } from "../commerce";
import { expireUnpaidOrders, recoverPendingRefunds } from "../payments";
import { runPriceIndex } from "../price-index";
import { buildExport } from "../privacy";

on("import.requested", async (e, enqueue) => {
  const p = e.payload as { batchId: string; userId: string; orgId: string };
  await enqueue("default", "import.products", p, `import:${p.batchId}`);
});

on("boq.uploaded", async (e, enqueue) => {
  const p = e.payload as { documentId: string; reprocess?: number };
  await enqueue("boq", "process", { documentId: p.documentId, orgId: e.orgId }, `boq:${p.documentId}:${p.reprocess ?? 0}`);
});
registerProcessor("boq", "process", async (d) => processBoq(String(d.documentId)));

on("rfq.recipient_send", async (e, enqueue) => {
  const p = e.payload as { recipientId: string };
  await enqueue("rfq", "deliver", { recipientId: p.recipientId, orgId: e.orgId }, `rfq-deliver:${e.dedupeKey ?? e.id}`);
});
registerProcessor("rfq", "deliver", async (d) => deliverRecipient(String(d.recipientId)));
on("rfq.cancelled_notify", async (e, enqueue) => {
  await enqueue("default", "rfq.cancelled_notify", e.payload, `rfq-cancel:${e.aggregateId}`);
});
registerProcessor("default", "rfq.cancelled_notify", async (d) => notifyCancelled(String(d.recipientId), String(d.reason), String(d.code), String(d.title)));
registerProcessor("rfq", "close_due", async () => closeDueRfqs());

on("po.issued", async (e, enqueue) => {
  const p = e.payload as { poId: string };
  await enqueue("pdf", "po", { poId: p.poId, orgId: e.orgId }, `po-pdf:${p.poId}`);
});
registerProcessor("pdf", "po", async (d) => generatePoDocuments(String(d.poId)));
registerProcessor("default", "po.flag_delays", async () => flagDelays());

registerProcessor("default", "import.products", async (d) => processProductImport(String(d.batchId), String(d.userId), String(d.orgId)));
registerProcessor("default", "suppliers.expire_documents", async () => expireDocuments());
registerProcessor("default", "reference.sync", async () => syncReferenceData());

registerProcessor("default", "store.expire_unpaid", async () => expireUnpaidOrders());
registerProcessor("default", "store.recover_refunds", async () => recoverPendingRefunds());
registerProcessor("default", "store.complete_delivered", async () => completeDeliveredGroups());

registerProcessor("analytics", "price_index.run", async () => runPriceIndex());

on("privacy.export_requested", async (e, enqueue) => {
  const p = e.payload as { requestId: string };
  await enqueue("default", "privacy.export", { requestId: p.requestId }, `privacy-export:${p.requestId}`);
});
registerProcessor("default", "privacy.export", async (d) => buildExport(String(d.requestId)));

registerProcessor("default", "store.refresh_prices", async () => {
  const { withSystem } = await import("@platform/db");
  const { sql } = await import("drizzle-orm");
  return withSystem((tx) => tx.execute(sql`select refresh_all_store_prices() as n`));
});

export const WIRED = true;
