import { createServer } from "node:http";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { logger } from "@platform/core/logger";
import { closeDb, getPool } from "@platform/db";
import { handleEvent, type QueueName } from "@platform/modules/events";
import { getProcessor, QUEUES, recordJob } from "@platform/modules/jobs";
import { dispatchOutbox } from "@platform/modules/outbox";
import { syncSystemRoles } from "@platform/modules/organizations";
import "./register";

process.env.SERVICE_NAME ??= "worker";
const log = logger.child({ service: "worker" });
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6390";
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const queues = new Map<QueueName, Queue>(QUEUES.map((q) => [q, new Queue(q, { connection, defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 } })]));

async function enqueue(queue: QueueName, name: string, data: Record<string, unknown>, jobId: string) {
  // Deterministic jobId → BullMQ ignores duplicates while the job exists (idempotent enqueue).
  await queues.get(queue)!.add(name, data, { jobId: jobId.replace(/:/g, "_") });
}

const concurrency: Record<QueueName, number> = { email: 4, boq: 1, pdf: 1, analytics: 1, rfq: 2, default: 2 };

const workers = QUEUES.map(
  (q) =>
    new Worker(
      q,
      async (job: Job) => {
        const fn = getProcessor(q, job.name);
        if (!fn) throw new Error(`No processor for ${q}/${job.name}`);
        return recordJob({ queue: q, name: job.name, jobId: String(job.id), attempt: job.attemptsMade + 1, orgId: (job.data?.orgId as string) ?? null }, () => fn(job.data ?? {}));
      },
      { connection, concurrency: concurrency[q], lockDuration: q === "boq" ? 300_000 : 60_000 },
    ),
);
for (const w of workers) w.on("failed", (job, err) => log.warn({ queue: w.name, jobId: job?.id, err: err.message }, "job failed"));

let stopping = false;
async function outboxLoop() {
  while (!stopping) {
    try {
      const n = await dispatchOutbox((e) => handleEvent(e, enqueue));
      if (n === 0) await new Promise((r) => setTimeout(r, 1000));
    } catch (e) {
      log.error({ err: e }, "outbox dispatch failed");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const port = Number(process.env.WORKER_HEALTH_PORT ?? 3101);
const health = createServer(async (_req, res) => {
  try {
    await getPool().query("select 1");
    await connection.ping();
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: (e as Error).message }));
  }
});

async function main() {
  await syncSystemRoles();
  try {
    const { getStorage } = await import("@platform/integrations/storage");
    await getStorage().ensureBucket();
  } catch (e) {
    log.warn({ err: (e as Error).message }, "object storage not ready (uploads will fail until configured)");
  }
  const { scheduleRecurring } = await import("./schedules");
  await scheduleRecurring(queues);
  health.listen(port, () => log.info({ port }, "worker health listening"));
  log.info({ queues: QUEUES }, "worker started");
  void outboxLoop();
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, "worker shutting down");
  health.close();
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled([...queues.values()].map((q) => q.close()));
  await connection.quit().catch(() => undefined);
  await closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((e) => {
  log.fatal({ err: e }, "worker failed to start");
  process.exit(1);
});
