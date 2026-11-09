import type { Queue } from "bullmq";
import type { QueueName } from "@platform/modules/events";

/** Recurring jobs (cron, Asia/Riyadh). Upserted on every start; BullMQ dedupes by scheduler id. */
export async function scheduleRecurring(queues: Map<QueueName, Queue>): Promise<void> {
  const tz = "Asia/Riyadh";
  const def = queues.get("default")!;
  await def.upsertJobScheduler("cleanup-idempotency", { pattern: "15 3 * * *", tz }, { name: "cleanup", data: {} });
  await queues.get("rfq")!.upsertJobScheduler("close-due-rfqs", { every: 5 * 60_000 }, { name: "close_due", data: {} });
  await def.upsertJobScheduler("flag-po-delays", { pattern: "0 * * * *", tz }, { name: "po.flag_delays", data: {} });
  await def.upsertJobScheduler("expire-unpaid-orders", { every: 5 * 60_000 }, { name: "store.expire_unpaid", data: {} });
  await def.upsertJobScheduler("complete-delivered-groups", { pattern: "30 * * * *", tz }, { name: "store.complete_delivered", data: {} });
  await queues.get("analytics")!.upsertJobScheduler("price-index-daily", { pattern: "30 2 * * *", tz }, { name: "price_index.run", data: {} });
  await def.upsertJobScheduler("refresh-store-prices", { pattern: "5 0 * * *", tz }, { name: "store.refresh_prices", data: {} });
  await def.upsertJobScheduler("expire-supplier-documents", { pattern: "0 2 * * *", tz }, { name: "suppliers.expire_documents", data: {} });
}
