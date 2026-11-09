import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { AppError, brandName, notFound } from "@platform/core";
import { currentTx, withContext, withSystem, type Tx } from "@platform/db";
import { authUsers, notificationDeliveries, notificationTemplates, notifications } from "@platform/db/schema";
import { getEmailTransport, type SmtpConfig } from "@platform/integrations/email";
import { getSetting } from "../config";
import { requireUser } from "../authz";
import { dbCtx, type Ctx } from "../context";
import { emit } from "../outbox";
import { TEMPLATES, type TemplateDef, type TemplateKey } from "./templates";

export { TEMPLATES, type TemplateKey } from "./templates";

type Params = Record<string, string | number | null | undefined>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function interpolate(tpl: string, params: Params, html: boolean): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
    const v = params[k];
    const s = v === null || v === undefined ? "" : String(v);
    return html ? esc(s) : s;
  });
}

const brand = (locale: "ar" | "en") => brandName(locale);

async function templateFor(key: TemplateKey, locale: "ar" | "en"): Promise<TemplateDef> {
  const base = TEMPLATES[key]?.[locale];
  if (!base) throw new AppError("INTERNAL", `Unknown template ${key}`);
  const [override] = await withSystem((tx) =>
    tx.select().from(notificationTemplates).where(and(eq(notificationTemplates.key, key), eq(notificationTemplates.locale, locale))).limit(1),
  );
  return override ? { ...base, subject: override.subject, body: override.body } : base;
}

export function renderEmail(def: TemplateDef, locale: "ar" | "en", params: Params): { subject: string; html: string; text: string } {
  const p: Params = { brand: brand(locale), ...params };
  const subject = interpolate(def.subject, p, false);
  const bodyText = interpolate(def.body, p, false);
  const bodyHtml = interpolate(def.body, p, true)
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => `<p style="margin:0 0 12px">${l}</p>`)
    .join("");
  const url = typeof p.actionUrl === "string" && /^https?:\/\//.test(p.actionUrl) ? p.actionUrl : null;
  const dir = locale === "ar" ? "rtl" : "ltr";
  const button =
    def.action && url
      ? `<p style="margin:24px 0"><a href="${esc(url)}" style="background:#0f5c4d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${esc(def.action)}</a></p>`
      : "";
  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f4f5f2;font-family:'IBM Plex Sans Arabic',Tahoma,Arial,sans-serif;color:#1d2622">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="background:#0f5c4d;color:#fff;padding:16px 24px;font-size:20px;font-weight:700" dir="${dir}">${esc(brand(locale))}</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.7;text-align:${locale === "ar" ? "right" : "left"}" dir="${dir}">${bodyHtml}${button}</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:#6b746f;border-top:1px solid #e6e8e3" dir="${dir}">${locale === "ar" ? "رسالة آلية — يرجى عدم الرد." : "Automated message — please do not reply."}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${bodyText}${url ? `\n\n${def.action ?? ""}: ${url}` : ""}`;
  return { subject, html, text };
}

export interface EmailRequest {
  to: string;
  template: TemplateKey;
  locale: "ar" | "en";
  params: Params;
  userId?: string | null;
  orgId?: string | null;
  /** Stable dedupe key: the same key never sends twice. */
  dedupeKey: string;
}

/**
 * Queue an email delivery (row + outbox event) in the caller's transaction. Sending happens in the
 * worker. Duplicate dedupe keys are ignored.
 */
export async function queueEmail(req: EmailRequest, tx?: Tx): Promise<void> {
  const t = tx ?? currentTx();
  const run = async (s: Tx) => {
    const rows = await s
      .insert(notificationDeliveries)
      .values({
        channel: "email",
        recipient: req.to,
        userId: req.userId ?? null,
        orgId: req.orgId ?? null,
        template: req.template,
        locale: req.locale,
        params: req.params as Record<string, unknown>,
        dedupeKey: req.dedupeKey,
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id });
    if (rows[0]) await emit({ topic: "email.send", aggregateType: "notification_delivery", aggregateId: rows[0].id, payload: { deliveryId: rows[0].id } }, s);
  };
  // deliveries are system-only rows: switch to system context inside the caller's transaction
  if (t) await withContext({ userId: null, orgId: null, mode: "system" }, run);
  else await withSystem(run);
}

/** Remove one-time secrets (links with tokens, codes) from stored params once delivered. */
const SECRET_PARAMS = ["actionUrl", "code", "token"];
function scrub(params: Record<string, unknown>): Record<string, unknown> {
  const out = { ...params };
  for (const k of SECRET_PARAMS) if (k in out) out[k] = "[delivered]";
  return out;
}

let smtpCache: { at: number; cfg: SmtpConfig | null } | null = null;

/** SMTP from admin settings (password encrypted at rest) when configured, else environment. Cached 60s. */
export async function resolveEmailTransport() {
  if (!smtpCache || Date.now() - smtpCache.at > 60_000) {
    const s = await getSetting<{ host?: string; port?: number | string; user?: string; from?: string; secure?: boolean }>("smtp").catch(() => ({ value: null, secret: null }));
    const v = s.value;
    smtpCache = { at: Date.now(), cfg: v?.host && v.from ? { host: v.host, port: Number(v.port ?? 587), user: v.user || undefined, pass: s.secret ?? undefined, from: v.from, secure: Boolean(v.secure) } : null };
  }
  return getEmailTransport(smtpCache.cfg ?? undefined);
}

export function invalidateEmailSettings() {
  smtpCache = null;
}

/** Send a queued delivery (worker). Safe to call repeatedly; already-sent deliveries are skipped. */
export async function sendDelivery(deliveryId: string, opts: { maxAttempts?: number } = {}): Promise<"sent" | "skipped_no_config" | "failed" | "noop"> {
  const maxAttempts = opts.maxAttempts ?? 5;
  let retryError: unknown = null;
  const result = await withSystem(async (tx) => {
    const [d] = await tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.id, deliveryId)).limit(1).for("update");
    if (!d) throw notFound("Delivery");
    if (d.status === "sent" || d.status === "skipped_no_config") return "noop" as const;
    const transport = await resolveEmailTransport();
    if (!transport.isConfigured()) {
      await tx.update(notificationDeliveries).set({ status: "skipped_no_config", lastError: "SMTP not configured" }).where(eq(notificationDeliveries.id, d.id));
      return "skipped_no_config" as const;
    }
    const def = await templateFor(d.template as TemplateKey, d.locale === "en" ? "en" : "ar");
    const msg = renderEmail(def, d.locale === "en" ? "en" : "ar", d.params as Params);
    try {
      const res = await transport.send({ to: d.recipient, ...msg, headers: { "X-Delivery-Id": d.id } });
      await tx
        .update(notificationDeliveries)
        .set({ status: "sent", attempts: d.attempts + 1, providerMessageId: res.messageId, sentAt: new Date(), lastError: null, params: scrub(d.params) })
        .where(eq(notificationDeliveries.id, d.id));
      return "sent" as const;
    } catch (e) {
      const attempts = d.attempts + 1;
      // persist the failure (commit), then let the queue retry with backoff
      await tx
        .update(notificationDeliveries)
        .set({ status: attempts >= maxAttempts ? "failed" : "pending", attempts, lastError: String((e as Error).message).slice(0, 500) })
        .where(eq(notificationDeliveries.id, d.id));
      if (attempts >= maxAttempts) return "failed" as const;
      retryError = e;
      return "failed" as const;
    }
  });
  if (retryError) throw retryError;
  return result;
}

export interface InAppRequest {
  userIds: string[];
  kind: TemplateKey;
  params: Params;
  link?: string;
  orgId?: string | null;
  dedupeKey?: string;
  /** Also send email to each user using their locale. */
  email?: boolean;
}

/** Create in-app notifications (and optional emails) for users. Joins caller's transaction. */
export async function notifyUsers(req: InAppRequest, tx?: Tx): Promise<void> {
  if (!req.userIds.length) return;
  const run = async (s: Tx) => {
    const users = await s.select({ id: authUsers.id, email: authUsers.email, locale: authUsers.locale, name: authUsers.name }).from(authUsers).where(inArray(authUsers.id, req.userIds));
    for (const u of users) {
      await s
        .insert(notifications)
        .values({ userId: u.id, orgId: req.orgId ?? null, kind: req.kind, params: req.params as Record<string, string | number>, link: req.link ?? null, dedupeKey: req.dedupeKey ?? null })
        .onConflictDoNothing();
      if (req.email) {
        const actionUrl = req.link ? new URL(`/${u.locale === "en" ? "en" : "ar"}${req.link}`, process.env.APP_URL ?? "http://localhost:3100").toString() : undefined;
        await queueEmail(
          { to: u.email, template: req.kind, locale: u.locale === "en" ? "en" : "ar", params: { name: u.name, ...req.params, actionUrl }, userId: u.id, orgId: req.orgId, dedupeKey: `${req.dedupeKey ?? `${req.kind}:${Date.now()}`}:${u.id}` },
          s,
        );
      }
    }
  };
  const t = tx ?? currentTx();
  if (t) await withContext({ userId: null, orgId: null, mode: "system" }, run);
  else await withSystem(run);
}

export function renderInApp(kind: string, params: Params, locale: "ar" | "en"): { title: string; body: string } {
  const def = TEMPLATES[kind as TemplateKey]?.[locale];
  if (!def) return { title: kind, body: "" };
  const p = { brand: brand(locale), ...params };
  return { title: interpolate(def.subject, p, false), body: interpolate(def.body, p, false).split("\n")[0] ?? "" };
}

export async function listMyNotifications(ctx: Ctx, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  requireUser(ctx);
  return withContext(dbCtx(ctx), async (tx) => {
    const rows = await tx
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.userId!), opts.unreadOnly ? isNull(notifications.readAt) : undefined))
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(opts.limit ?? 30, 100));
    return rows.map((r) => ({ ...r, ...renderInApp(r.kind, r.params, ctx.locale) }));
  });
}

export async function unreadCount(ctx: Ctx): Promise<number> {
  if (!ctx.userId) return 0;
  return withContext(dbCtx(ctx), async (tx) => {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, ctx.userId!), isNull(notifications.readAt)));
    return r?.n ?? 0;
  });
}

export async function markRead(ctx: Ctx, ids: string[] | "all") {
  requireUser(ctx);
  return withContext(dbCtx(ctx), (tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.userId!), isNull(notifications.readAt), ids === "all" ? undefined : inArray(notifications.id, ids))),
  );
}
