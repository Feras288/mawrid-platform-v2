import type { ClaimedEvent } from "../outbox";

/**
 * Outbox topic → handler registry. Handlers must be idempotent (events may be redelivered).
 * Heavy handlers only enqueue queue jobs (the worker passes an `enqueue` function).
 */
export type Enqueue = (queue: QueueName, name: string, data: Record<string, unknown>, jobId: string) => Promise<void>;
export type QueueName = "email" | "boq" | "pdf" | "analytics" | "rfq" | "default";
export type Handler = (e: ClaimedEvent, enqueue: Enqueue) => Promise<void>;

const registry = new Map<string, Handler[]>();

export function on(topic: string, handler: Handler): void {
  const list = registry.get(topic) ?? [];
  list.push(handler);
  registry.set(topic, list);
}

export async function handleEvent(e: ClaimedEvent, enqueue: Enqueue): Promise<void> {
  const handlers = registry.get(e.topic) ?? [];
  for (const h of handlers) await h(e, enqueue);
}

export const registeredTopics = () => [...registry.keys()];

// Core subscriptions --------------------------------------------------------------------------
on("email.send", async (e, enqueue) => {
  const deliveryId = String(e.payload.deliveryId);
  await enqueue("email", "send", { deliveryId }, `email:${deliveryId}`);
});
