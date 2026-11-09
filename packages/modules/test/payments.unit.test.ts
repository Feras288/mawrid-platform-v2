import { describe, expect, it } from "vitest";
import { allocate } from "@platform/core";
import { BankTransferProvider, fromMinor, MoyasarProvider, TestPaymentProvider, toMinor } from "@platform/integrations/payments";
import { decodeTlv, isSaudiVatNumber, zatcaQrTlv } from "@platform/integrations/zatca";
import { deriveOrderStatus } from "../src/commerce";

type Call = { url: string; init: RequestInit };
function mockFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("minor units", () => {
  it("converts without floating point", () => {
    expect(toMinor("626.75")).toBe(62675);
    expect(toMinor("0.1")).toBe(10);
    expect(toMinor("19.99")).toBe(1999);
    expect(fromMinor(62675)).toBe("626.75");
    expect(fromMinor(5)).toBe("0.05");
    expect(() => toMinor("1.234")).toThrow();
  });
});

describe("Moyasar adapter (contract, mocked HTTP)", () => {
  it("creates a hosted invoice in halalas with Basic auth and an idempotency key", async () => {
    const { f, calls } = mockFetch([{ status: 201, body: { id: "inv_1", status: "initiated", url: "https://checkout.moyasar.com/invoices/inv_1" } }]);
    const p = new MoyasarProvider({ secretKey: "sk_test_x", webhookSecret: "whsec", fetchImpl: f });
    const r = await p.createPayment({ intentId: "int-1", amountMinor: 62675, currency: "SAR", description: "Order ORD-1", successUrl: "https://app/s", backUrl: "https://app/b", callbackUrl: "https://app/cb" });
    expect(r).toEqual({ providerRef: "inv_1", status: "pending", redirectUrl: "https://checkout.moyasar.com/invoices/inv_1" });
    expect(calls[0]!.url).toBe("https://api.moyasar.com/v1/invoices");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Basic ${Buffer.from("sk_test_x:").toString("base64")}`);
    expect(h["idempotency-key"]).toBe("int-1");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ amount: 62675, currency: "SAR", success_url: "https://app/s", callback_url: "https://app/cb", metadata: { intent_id: "int-1" } });
  });

  it("maps invoice status and exposes the captured payment id", async () => {
    const { f } = mockFetch([{ status: 200, body: { id: "inv_1", status: "paid", amount: 62675, currency: "SAR", payments: [{ id: "pay_9", status: "paid" }] } }]);
    const p = new MoyasarProvider({ secretKey: "sk", webhookSecret: "w", fetchImpl: f });
    const r = await p.fetchPayment("inv_1");
    expect(r).toMatchObject({ status: "succeeded", amountMinor: 62675, currency: "SAR", paymentId: "pay_9" });
  });

  it("verifies the webhook secret token and never trusts unsigned payloads", () => {
    const p = new MoyasarProvider({ secretKey: "sk", webhookSecret: "correct-secret" });
    const body = (token: string) => JSON.stringify({ id: "evt_1", type: "payment_paid", secret_token: token, data: { id: "pay_1", invoice_id: "inv_1" } });
    expect(p.parseWebhook(body("wrong"))).toBeNull();
    expect(p.parseWebhook("not json")).toBeNull();
    const ev = p.parseWebhook(body("correct-secret"))!;
    expect(ev).toMatchObject({ eventId: "evt_1", type: "payment_paid", providerRef: "inv_1" });
    expect(JSON.stringify(ev.raw)).not.toContain("correct-secret");
  });

  it("reports provider errors as failed refunds instead of throwing", async () => {
    const { f } = mockFetch([{ status: 400, body: { type: "invalid_request_error", message: "amount too big" } }]);
    const p = new MoyasarProvider({ secretKey: "sk", webhookSecret: "w", fetchImpl: f });
    const r = await p.refund("pay_1", 100, "rf-1");
    expect(r.status).toBe("failed");
    expect(r.failureReason).toContain("amount too big");
  });

  it("treats 5xx, throttling, timeouts and network errors as UNKNOWN outcomes (thrown for retry), not terminal failures", async () => {
    for (const status of [500, 502, 503, 408, 429]) {
      const { f } = mockFetch([{ status, body: { message: "try later" } }]);
      const p = new MoyasarProvider({ secretKey: "sk", webhookSecret: "w", fetchImpl: f });
      await expect(p.refund("pay_1", 100, "rf-1"), `HTTP ${status}`).rejects.toBeDefined();
    }
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(new MoyasarProvider({ secretKey: "sk", webhookSecret: "w", fetchImpl: down }).refund("pay_1", 100, "rf-1")).rejects.toThrow("fetch failed");
    // an unparseable gateway page is also an unknown outcome
    const html = (async () => new Response("<html>bad gateway</html>", { status: 200 })) as unknown as typeof fetch;
    await expect(new MoyasarProvider({ secretKey: "sk", webhookSecret: "w", fetchImpl: html }).refund("pay_1", 100, "rf-1")).rejects.toBeDefined();
  });

  it("sends the refund idempotency key on every attempt", async () => {
    const { f, calls } = mockFetch([{ status: 502, body: {} }, { status: 200, body: { id: "pay_1", status: "refunded" } }]);
    const p = new MoyasarProvider({ secretKey: "sk", webhookSecret: "w", fetchImpl: f });
    await expect(p.refund("pay_1", 100, "rf-key")).rejects.toBeDefined();
    expect((await p.refund("pay_1", 100, "rf-key")).status).toBe("succeeded");
    expect(calls.map((c) => (c.init.headers as Record<string, string>)["idempotency-key"])).toEqual(["rf-key", "rf-key"]);
  });

  it("fetchRefund is a read-only GET and confirms only when the cumulative refunded total covers the confirmed amount plus this refund", async () => {
    const lookup = { paymentId: "pay_1", providerRef: "pay_1", amountMinor: 700, refundedBeforeMinor: 500, idempotencyKey: "rf-2" };
    const ask = async (body: unknown) => {
      const { f, calls } = mockFetch([{ status: 200, body }]);
      const r = await new MoyasarProvider({ secretKey: "sk", webhookSecret: "w", fetchImpl: f }).fetchRefund(lookup);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.init.method).toBe("GET");
      expect(calls[0]!.url).toContain("/payments/pay_1");
      return r.status;
    };
    expect(await ask({ id: "pay_1", status: "paid", refunded: 500 })).toBe("pending"); // only the earlier refund is there
    expect(await ask({ id: "pay_1", status: "paid", refunded: 1199 })).toBe("pending");
    expect(await ask({ id: "pay_1", status: "paid", refunded: 1200 })).toBe("succeeded");
    expect(await ask({ id: "pay_1", status: "refunded", refunded: 2300 })).toBe("succeeded");
    expect(await ask({ id: "pay_1", status: "paid" })).toBe("pending");
    const { f } = mockFetch([{ status: 503, body: {} }]);
    await expect(new MoyasarProvider({ secretKey: "sk", webhookSecret: "w", fetchImpl: f }).fetchRefund(lookup)).rejects.toBeDefined(); // lookup failure is not a verdict
  });

  it("is not configured without keys", async () => {
    const p = new MoyasarProvider({});
    expect(p.isConfigured()).toBe(false);
    await expect(p.createPayment({ intentId: "x", amountMinor: 100, currency: "SAR", description: "d", successUrl: "u", backUrl: "u", callbackUrl: "u" })).rejects.toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
  });
});

describe("test & bank-transfer providers", () => {
  it("test provider refuses to run in production", () => {
    const prev = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      expect(() => new TestPaymentProvider("s", (id) => id)).toThrow(/not allowed in production/);
    } finally {
      process.env.APP_ENV = prev;
    }
  });
  it("test provider webhooks require the HMAC signature", () => {
    const p = new TestPaymentProvider("secret", (id) => `/pay/${id}`);
    const body = JSON.stringify({ id: "e1", type: "t", ref: "r1" });
    expect(p.parseWebhook(body, new Headers({ "x-test-signature": "bad" }))).toBeNull();
    expect(p.parseWebhook(body, new Headers({ "x-test-signature": p.sign(body) }))?.providerRef).toBe("r1");
  });
  it("test provider replays the original refund for a repeated idempotency key and never over-refunds", async () => {
    const p = new TestPaymentProvider("secret", () => "u");
    const ref = `test_unit_${Math.random().toString(36).slice(2)}`;
    await p.createPayment({ intentId: ref.slice(5), amountMinor: 1000, currency: "SAR", description: "d", successUrl: "u", backUrl: "u", callbackUrl: "u" });
    TestPaymentProvider.settle(ref, "succeeded");
    const a = await p.refund(ref, 600, "k1");
    expect(a.status).toBe("succeeded");
    expect(await p.refund(ref, 600, "k1")).toEqual(a);
    expect(TestPaymentProvider.refundedMinor(ref)).toBe(600);
    expect((await p.refund(ref, 600, "k2")).failureReason).toBe("invalid_amount");
    expect(TestPaymentProvider.refundedMinor(ref)).toBe(600);
  });
  it("bank transfer returns instructions and requires manual refunds", async () => {
    const p = new BankTransferProvider({ bankName: "Bank", iban: "SA0000000000000000000000", beneficiary: "Seller" });
    const r = await p.createPayment({ intentId: "0190aaaa-bbbb-7ccc-8ddd-eeeeffff0000", amountMinor: 12345, currency: "SAR", description: "d", successUrl: "u", backUrl: "u", callbackUrl: "u" });
    expect(r.redirectUrl).toBeNull();
    expect(r.instructions).toMatchObject({ amount: "123.45", iban: "SA0000000000000000000000" });
    expect((await p.refund()).failureReason).toBe("manual_refund_required");
    expect(new BankTransferProvider({}).isConfigured()).toBe(false);
  });
});

describe("ZATCA simplified-invoice QR (TLV)", () => {
  it("encodes the five mandatory tags and round-trips Arabic seller names", () => {
    const at = new Date("2026-11-09T10:15:30.000Z");
    const b64 = zatcaQrTlv({ sellerName: "مؤسسة التوريد", vatNumber: "300000000000003", timestamp: at, total: "488.75", vatTotal: "63.75" });
    expect(decodeTlv(b64)).toEqual({ 1: "مؤسسة التوريد", 2: "300000000000003", 3: "2026-11-09T10:15:30Z", 4: "488.75", 5: "63.75" });
    expect(Buffer.from(b64, "base64")[0]).toBe(1);
  });
  it("validates Saudi VAT numbers", () => {
    expect(isSaudiVatNumber("300000000000003")).toBe(true);
    expect(isSaudiVatNumber("100000000000003")).toBe(false);
    expect(isSaudiVatNumber(null)).toBe(false);
  });
});

describe("allocation and order status", () => {
  it("never assigns rounding cents to zero-weight parts", () => {
    expect(allocate("0.05", ["10", "0", "0"]).map((d) => d.toFixed(2))).toEqual(["0.05", "0.00", "0.00"]);
    expect(allocate("100.01", ["488.75", "0", "0"]).map((d) => d.toFixed(2))).toEqual(["100.01", "0.00", "0.00"]);
    const parts = allocate("10.00", ["1", "1", "1"]);
    expect(parts.reduce((a, b) => a.plus(b)).toFixed(2)).toBe("10.00");
  });
  it("derives the order status from its supplier groups", () => {
    expect(deriveOrderStatus([{ status: "cancelled" }, { status: "cancelled" }], "placed")).toBe("cancelled");
    expect(deriveOrderStatus([{ status: "completed" }, { status: "cancelled" }], "in_progress")).toBe("completed");
    expect(deriveOrderStatus([{ status: "confirmed" }, { status: "shipped" }], "placed")).toBe("in_progress");
    expect(deriveOrderStatus([{ status: "confirmed" }], "placed")).toBe("placed");
    expect(deriveOrderStatus([{ status: "awaiting_payment" }], "pending_payment")).toBe("pending_payment");
  });
});
