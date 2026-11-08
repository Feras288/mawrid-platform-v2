/**
 * Wires outbox topics to queue jobs and queue jobs to module processors. Imported by the worker.
 * Keep handlers thin: they only enqueue; processors do the work and must be idempotent.
 */
import { on } from "../events";
import { processProductImport } from "../imports";
import { registerProcessor } from "../jobs";
import { syncReferenceData } from "../reference";
import { expireDocuments } from "../suppliers";

on("import.requested", async (e, enqueue) => {
  const p = e.payload as { batchId: string; userId: string; orgId: string };
  await enqueue("default", "import.products", p, `import:${p.batchId}`);
});

registerProcessor("default", "import.products", async (d) => processProductImport(String(d.batchId), String(d.userId), String(d.orgId)));
registerProcessor("default", "suppliers.expire_documents", async () => expireDocuments());
registerProcessor("default", "reference.sync", async () => syncReferenceData());

export const WIRED = true;
