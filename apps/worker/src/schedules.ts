import type { Queue } from "bullmq";
import type { QueueName } from "@platform/modules/events";

/** Recurring jobs (cron, Asia/Riyadh). Upserted on every start; BullMQ dedupes by scheduler id. */
export async function scheduleRecurring(queues: Map<QueueName, Queue>): Promise<void> {
  const tz = "Asia/Riyadh";
  const def = queues.get("default")!;
  await def.upsertJobScheduler("cleanup-idempotency", { pattern: "15 3 * * *", tz }, { name: "cleanup", data: {} });
}
