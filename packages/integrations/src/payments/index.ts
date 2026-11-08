import { AppError, hmacSha256, safeEqual } from "@platform/core";

/**
 * Payment provider abstraction. Amounts cross this boundary as integer minor units (halalas) to avoid
 * any float conversion. Providers never decide business state on their own: the payments module
 * re-validates amount/currency against the intent before marking anything paid.
 */
export type ProviderStatus = "pending" | "succeeded" | "failed" | "expired" | "cancelled" | "refunded";

export interface CreatePaymentInput {
  intentId: string;
  amountMinor: number;
  currency: string;
  description: string;
  successUrl: string;
  backUrl: string;
  callbackUrl: string;
  expiresAt?: Date | null;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  providerRef: string;
  status: ProviderStatus;
  redirectUrl: string | null;
  instructions?: Record<string, string>;
}

export interface FetchedPayment {
  providerRef: string;
  status: ProviderStatus;
  amountMinor: number;
  currency: string;
  /** provider id of the captured payment (refunds target this) */
  paymentId: string | null;
  failureReason?: string | null;
  raw: Record<string, unknown>;
}

export interface WebhookEvent {
  eventId: string;
  type: string;
  /** reference used to locate the intent (invoice id / intent ref) */
  providerRef: string | null;
  raw: Record<string, unknown>;
}

export interface RefundResult {
  status: "succeeded" | "failed" | "pending";
  providerRef: string | null;
  failureReason?: string | null;
}

export interface PaymentProvider {
  readonly name: "test" | "moyasar" | "bank_transfer";
  /** true when the provider sends the customer to a hosted page */
  readonly redirects: boolean;
  isConfigured(): boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  fetchPayment(providerRef: string): Promise<FetchedPayment>;
  refund(paymentId: string, amountMinor: number, idempotencyKey: string): Promise<RefundResult>;
  /** Verify authenticity and parse; returns null when the signature/secret is invalid. */
  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null;
}

const notProd = (name: string) => {
  if (process.env.APP_ENV === "production") throw new Error(`${name} payment provider is not allowed in production`);
};

// ------------------------------------------------------------------------------------------ test provider

/**
 * Test provider for development/test only. The "hosted page" is our own simulator route, which posts
 * an HMAC-signed webhook. Payment state lives in-process (keyed by intent) so `fetchPayment` reflects
 * what the simulator decided. Refuses to construct in production.
 */
export class TestPaymentProvider implements PaymentProvider {
  readonly name = "test" as const;
  readonly redirects = true;
  private static state = new Map<string, { status: ProviderStatus; amountMinor: number; currency: string }>();
  constructor(
    private secret: string,
    private simulatorUrl: (intentId: string) => string,
  ) {
    notProd("Test");
  }
  isConfigured() {
    return Boolean(this.secret);
  }
  async createPayment(i: CreatePaymentInput): Promise<CreatePaymentResult> {
    const ref = `test_${i.intentId}`;
    TestPaymentProvider.state.set(ref, { status: "pending", amountMinor: i.amountMinor, currency: i.currency });
    return { providerRef: ref, status: "pending", redirectUrl: this.simulatorUrl(i.intentId) };
  }
  /** Simulator / tests: record an outcome as the provider would. */
  static settle(ref: string, status: ProviderStatus, amountMinor?: number) {
    const cur = TestPaymentProvider.state.get(ref);
    TestPaymentProvider.state.set(ref, { status, amountMinor: amountMinor ?? cur?.amountMinor ?? 0, currency: cur?.currency ?? "SAR" });
  }
  async fetchPayment(ref: string): Promise<FetchedPayment> {
    const s = TestPaymentProvider.state.get(ref);
    if (!s) throw new AppError("NOT_FOUND", "Unknown test payment", { key: "not_found" });
    return { providerRef: ref, status: s.status, amountMinor: s.amountMinor, currency: s.currency, paymentId: ref, raw: { ...s } };
  }
  async refund(paymentId: string, amountMinor: number): Promise<RefundResult> {
    const s = TestPaymentProvider.state.get(paymentId);
    if (!s || s.status !== "succeeded") return { status: "failed", providerRef: null, failureReason: "not_captured" };
    if (amountMinor <= 0 || amountMinor > s.amountMinor) return { status: "failed", providerRef: null, failureReason: "invalid_amount" };
    return { status: "succeeded", providerRef: `${paymentId}_rf_${Date.now()}` };
  }
  sign(body: string) {
    return hmacSha256(this.secret, body);
  }
  parseWebhook(rawBody: string, headers: Headers): WebhookEvent | null {
    const sig = headers.get("x-test-signature") ?? "";
    if (!this.secret || !safeEqual(sig, this.sign(rawBody))) return null;
    const p = JSON.parse(rawBody) as { id: string; type: string; ref: string };
    return { eventId: p.id, type: p.type, providerRef: p.ref, raw: p as unknown as Record<string, unknown> };
  }
}

// ------------------------------------------------------------------------------------------ Moyasar

export interface MoyasarConfig {
  secretKey?: string;
  webhookSecret?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const MOYASAR_STATUS: Record<string, ProviderStatus> = {
  initiated: "pending",
  on_hold: "pending",
  authorized: "pending",
  verified: "pending",
  paid: "succeeded",
  captured: "succeeded",
  failed: "failed",
  expired: "expired",
  canceled: "cancelled",
  voided: "cancelled",
  refunded: "refunded",
};

/**
 * Moyasar adapter (hosted invoice flow). Create an invoice → redirect the payer to `url` → Moyasar
 * POSTs a webhook with the endpoint's `secret_token`; we compare it in constant time and then re-fetch
 * the invoice from the API, which is the authoritative source. Live use requires a merchant account and
 * keys (Integration Pending); behaviour is covered by contract tests with a mocked HTTP layer.
 */
export class MoyasarProvider implements PaymentProvider {
  readonly name = "moyasar" as const;
  readonly redirects = true;
  private base: string;
  private f: typeof fetch;
  constructor(private cfg: MoyasarConfig) {
    this.base = (cfg.baseUrl ?? "https://api.moyasar.com/v1").replace(/\/$/, "");
    this.f = cfg.fetchImpl ?? fetch;
  }
  isConfigured() {
    return Boolean(this.cfg.secretKey && this.cfg.webhookSecret);
  }
  private async call<T>(method: string, path: string, body?: unknown, idem?: string): Promise<T> {
    if (!this.cfg.secretKey) throw new AppError("INTEGRATION_UNAVAILABLE", "Moyasar is not configured", { key: "payment_not_configured" });
    const res = await this.f(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.cfg.secretKey}:`).toString("base64")}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(idem ? { "idempotency-key": idem } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) throw new AppError("INTEGRATION_FAILED", `Moyasar ${method} ${path} failed: ${res.status} ${String(json.message ?? "")}`.trim(), { key: "payment_provider", details: { status: res.status, type: json.type ?? null } });
    return json as T;
  }
  async createPayment(i: CreatePaymentInput): Promise<CreatePaymentResult> {
    const inv = await this.call<{ id: string; status: string; url: string }>(
      "POST",
      "/invoices",
      {
        amount: i.amountMinor,
        currency: i.currency,
        description: i.description.slice(0, 255),
        callback_url: i.callbackUrl,
        success_url: i.successUrl,
        back_url: i.backUrl,
        ...(i.expiresAt ? { expired_at: i.expiresAt.toISOString() } : {}),
        metadata: { intent_id: i.intentId, ...(i.metadata ?? {}) },
      },
      i.intentId,
    );
    return { providerRef: inv.id, status: MOYASAR_STATUS[inv.status] ?? "pending", redirectUrl: inv.url };
  }
  async fetchPayment(ref: string): Promise<FetchedPayment> {
    const inv = await this.call<{ id: string; status: string; amount: number; currency: string; payments?: { id: string; status: string; source?: { message?: string } }[] }>("GET", `/invoices/${encodeURIComponent(ref)}`);
    const paid = inv.payments?.find((p) => p.status === "paid" || p.status === "captured");
    const last = inv.payments?.at(-1);
    return {
      providerRef: inv.id,
      status: MOYASAR_STATUS[inv.status] ?? "pending",
      amountMinor: inv.amount,
      currency: inv.currency,
      paymentId: paid?.id ?? null,
      failureReason: inv.status === "failed" ? (last?.source?.message ?? "failed") : null,
      raw: inv as unknown as Record<string, unknown>,
    };
  }
  async refund(paymentId: string, amountMinor: number, idempotencyKey: string): Promise<RefundResult> {
    try {
      const p = await this.call<{ id: string; status: string }>("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountMinor }, idempotencyKey);
      return { status: p.status === "refunded" ? "succeeded" : "pending", providerRef: p.id };
    } catch (e) {
      return { status: "failed", providerRef: null, failureReason: e instanceof Error ? e.message : String(e) };
    }
  }
  parseWebhook(rawBody: string): WebhookEvent | null {
    let p: { id?: string; type?: string; secret_token?: string; data?: { id?: string; invoice_id?: string | null } };
    try {
      p = JSON.parse(rawBody);
    } catch {
      return null;
    }
    if (!this.cfg.webhookSecret || !p.secret_token || !safeEqual(p.secret_token, this.cfg.webhookSecret)) return null;
    if (!p.id || !p.type) return null;
    const { secret_token: _s, ...rest } = p;
    return { eventId: p.id, type: p.type, providerRef: p.data?.invoice_id ?? null, raw: rest as Record<string, unknown> };
  }
}

// ------------------------------------------------------------------------------------------ bank transfer

/** Manual bank transfer: an intent with instructions; confirmation is a manual, audited admin action. */
export class BankTransferProvider implements PaymentProvider {
  readonly name = "bank_transfer" as const;
  readonly redirects = false;
  constructor(private account: { bankName?: string; iban?: string; beneficiary?: string }) {}
  isConfigured() {
    return Boolean(this.account.iban && this.account.beneficiary);
  }
  async createPayment(i: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (!this.isConfigured()) throw new AppError("INTEGRATION_UNAVAILABLE", "Bank transfer details are not configured", { key: "payment_not_configured" });
    const ref = `BT-${i.intentId.replace(/-/g, "").slice(-10).toUpperCase()}`;
    return {
      providerRef: ref,
      status: "pending",
      redirectUrl: null,
      instructions: { bankName: this.account.bankName ?? "", iban: this.account.iban!, beneficiary: this.account.beneficiary!, reference: ref, amount: (i.amountMinor / 100).toFixed(2), currency: i.currency },
    };
  }
  async fetchPayment(ref: string): Promise<FetchedPayment> {
    return { providerRef: ref, status: "pending", amountMinor: 0, currency: "SAR", paymentId: null, raw: {} };
  }
  async refund(): Promise<RefundResult> {
    return { status: "pending", providerRef: null, failureReason: "manual_refund_required" };
  }
  parseWebhook(): WebhookEvent | null {
    return null;
  }
}

// ------------------------------------------------------------------------------------------ registry

const registry = new Map<string, PaymentProvider>();
export function setPaymentProvider(p: PaymentProvider | null, name?: string) {
  if (p) registry.set(p.name, p);
  else if (name) registry.delete(name);
}
export function getPaymentProvider(name: string): PaymentProvider | null {
  return registry.get(name) ?? null;
}

/** Minor units from a 2-decimal amount string without floats. */
export function toMinor(amount: string): number {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid amount ${amount}`);
  const v = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -v : v;
}
export function fromMinor(minor: number): string {
  const neg = minor < 0;
  const a = Math.abs(minor);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
