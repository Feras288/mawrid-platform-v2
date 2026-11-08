import { eq } from "drizzle-orm";
import { withSystem } from "@platform/db";
import { jobRuns } from "@platform/db/schema";
import type { QueueName } from "../events";
import { sendDelivery } from "../notifications";

export type Processor = (data: Record<string, unknown>) => Promise<unknown>;

/** Queue → job name → processor. Modules register their processors here. */
const processors: Record<QueueName, Record<string, Processor>> = { email: {}, boq: {}, pdf: {}, analytics: {}, rfq: {}, default: {} };

export function registerProcessor(queue: QueueName, name: string, fn: Processor): void {
  processors[queue][name] = fn;
}

export function getProcessor(queue: QueueName, name: string): Processor | undefined {
  return processors[queue][name];
}

export const QUEUES: QueueName[] = ["email", "boq", "pdf", "analytics", "rfq", "default"];

/** Record a job execution for the admin jobs monitor. */
export async function recordJob<T>(meta: { queue: string; name: string; jobId: string; attempt: number; orgId?: string | null }, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const [run] = await withSystem((tx) =>
    tx.insert(jobRuns).values({ queue: meta.queue, jobName: meta.name, jobId: meta.jobId, attempt: meta.attempt, status: "active", orgId: meta.orgId ?? null }).returning({ id: jobRuns.id }),
  );
  try {
    const r = await fn();
    await withSystem((tx) => tx.update(jobRuns).set({ status: "completed", finishedAt: new Date(), durationMs: Date.now() - started }).where(eq(jobRuns.id, run!.id)));
    return r;
  } catch (e) {
    await withSystem((tx) =>
      tx.update(jobRuns).set({ status: "failed", finishedAt: new Date(), durationMs: Date.now() - started, error: String((e as Error).message).slice(0, 2000) }).where(eq(jobRuns.id, run!.id)),
    );
    throw e;
  }
}

// core processors
registerProcessor("email", "send", async (data) => sendDelivery(String(data.deliveryId)));

registerProcessor("default", "cleanup", async () => {
  const { lt } = await import("drizzle-orm");
  const { idempotencyKeys } = await import("@platform/db/schema");
  await withSystem((tx) => tx.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date())));
});
