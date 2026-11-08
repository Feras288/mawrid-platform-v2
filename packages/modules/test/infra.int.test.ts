import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { randomToken } from "@platform/core";
import { withContext, withSystem } from "@platform/db";
import { outboxEvents } from "@platform/db/schema";
import { idempotent } from "../src/idempotency";
import { dispatchOutbox, emit } from "../src/outbox";
import { setupOrg } from "./helpers";

describe("idempotency", () => {
  it("returns the stored response on replay and rejects a different payload", async () => {
    const key = `k-${randomToken(8)}`;
    let calls = 0;
    const run = (body: unknown) => withSystem(() => idempotent("test", key, body, async () => ({ n: ++calls })));
    expect(await run({ a: 1 })).toEqual({ n: 1 });
    expect(await run({ a: 1 })).toEqual({ n: 1 });
    expect(calls).toBe(1);
    await expect(run({ a: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rolls back the key when the operation fails", async () => {
    const key = `k-${randomToken(8)}`;
    const failing = async (): Promise<string> => {
      throw new Error("boom");
    };
    await expect(withSystem(() => idempotent("test", key, {}, failing))).rejects.toThrow("boom");
    expect(await withSystem(() => idempotent("test", key, {}, async () => "ok"))).toBe("ok");
  });

  it("executes concurrent duplicates once", async () => {
    const key = `k-${randomToken(8)}`;
    let calls = 0;
    const op = () =>
      withSystem(() =>
        idempotent("conc", key, { x: 1 }, async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 100));
          return { ok: true };
        }),
      );
    const results = await Promise.allSettled([op(), op(), op()]);
    expect(calls).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(3);
  });
});

describe("outbox", () => {
  it("emits in-transaction, rolls back with the transaction, dispatches once", async () => {
    const a = await setupOrg("buyer");
    const c = { userId: a.user.id, orgId: a.org.id, mode: "user" as const };
    const id1 = randomToken(6);
    await withContext(c, (tx) => emit({ topic: "test.ok", aggregateType: "t", aggregateId: id1, payload: {} }, tx));
    const id2 = randomToken(6);
    await expect(
      withContext(c, async (tx) => {
        await emit({ topic: "test.rollback", aggregateType: "t", aggregateId: id2, payload: {} }, tx);
        throw new Error("fail");
      }),
    ).rejects.toThrow();
    expect(await withSystem((tx) => tx.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, id2)))).toHaveLength(0);

    const seen: string[] = [];
    const collect = async (e: { id: string; aggregateId: string }) => {
      if (e.aggregateId === id1) seen.push(e.id);
    };
    await dispatchOutbox(collect);
    await dispatchOutbox(collect);
    expect(seen).toHaveLength(1);
  });

  it("dedupes by key and retries failures with backoff", async () => {
    const key = `d-${randomToken(6)}`;
    await withSystem(async (tx) => {
      await emit({ topic: "test.dedupe", aggregateType: "t", aggregateId: key, payload: {}, dedupeKey: key }, tx);
      await emit({ topic: "test.dedupe", aggregateType: "t", aggregateId: key, payload: {}, dedupeKey: key }, tx);
    });
    expect(await withSystem((tx) => tx.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, key)))).toHaveLength(1);
    await dispatchOutbox(async (e) => {
      if (e.dedupeKey === key) throw new Error("handler down");
    });
    const [after] = await withSystem((tx) => tx.select().from(outboxEvents).where(eq(outboxEvents.dedupeKey, key)));
    expect(after!.status).toBe("pending");
    expect(after!.attempts).toBe(1);
    expect(after!.availableAt.getTime()).toBeGreaterThan(Date.now());
  });
});
