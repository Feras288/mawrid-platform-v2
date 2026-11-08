import { sql } from "drizzle-orm";
import { dec } from "@platform/core";
import { withContext, withSystem, type Tx } from "@platform/db";
import { authorize, authorizeAdmin, requireOrg } from "../authz";
import { dbCtx, type Ctx } from "../context";

/**
 * KPIs computed only from recorded business data (no estimates). Organization dashboards read the
 * organization's own records under RLS. Platform-level figures exclude every organization flagged
 * `is_test_data` (seed/demo/test) on either side of a transaction.
 */

type Row = Record<string, unknown>;
const one = async <T extends Row>(tx: Tx, q: ReturnType<typeof sql>) => ((await tx.execute(q)).rows[0] ?? {}) as T;
const many = async <T extends Row>(tx: Tx, q: ReturnType<typeof sql>) => (await tx.execute(q)).rows as T[];
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const money = (v: unknown) => dec(v === null || v === undefined || v === "" ? 0 : String(v)).toFixed(2);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export interface MonthPoint {
  month: string;
  value: string;
}

function fillMonths(rows: { m: string; v: unknown }[], months: number): MonthPoint[] {
  const out: MonthPoint[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ month: key, value: money(rows.find((r) => r.m === key)?.v ?? 0) });
  }
  return out;
}

export async function buyerKpis(ctx: Ctx, opts: { months?: number } = {}) {
  requireOrg(ctx, "buyer");
  authorize(ctx, "analytics.view");
  const months = Math.min(Math.max(opts.months ?? 12, 1), 36);
  const org = ctx.orgId;
  return withContext(dbCtx(ctx), async (tx) => {
    const spendRows = await many<{ m: string; v: string }>(
      tx,
      sql`select to_char(date_trunc('month', issued_at), 'YYYY-MM') as m, sum(total) as v from purchase_orders
          where org_id = ${org} and approval_status = 'approved' and fulfillment_status <> 'cancelled' and issued_at > date_trunc('month', now()) - make_interval(months => ${months - 1})
          group by 1`,
    );
    const po = await one<{ n: number; v: string }>(tx, sql`select count(*)::int as n, coalesce(sum(total),0) as v from purchase_orders where org_id = ${org} and approval_status = 'approved' and fulfillment_status <> 'cancelled'`);
    const rfq = await one<{ sent: number; recipients: number; responded: number; quotes: number; open: number }>(
      tx,
      sql`select count(*) filter (where r.sent_at is not null)::int as sent,
                 (select count(*) from rfq_recipients rc join rfqs x on x.id = rc.rfq_id where x.org_id = ${org} and rc.status in ('sent','responded','declined'))::int as recipients,
                 (select count(*) from rfq_recipients rc join rfqs x on x.id = rc.rfq_id where x.org_id = ${org} and rc.status = 'responded')::int as responded,
                 (select count(*) from quotations q where q.buyer_org_id = ${org} and q.status = 'submitted' and q.is_current)::int as quotes,
                 count(*) filter (where r.status in ('open','partially_responded','under_evaluation','revision_requested'))::int as open
          from rfqs r where r.org_id = ${org}`,
    );
    const cycle = await one<{ d: string | null }>(tx, sql`select percentile_cont(0.5) within group (order by extract(epoch from (awarded_at - sent_at)) / 86400) as d from rfqs where org_id = ${org} and awarded_at is not null and sent_at is not null`);
    const savings = await one<{ s: string | null; base: string | null }>(
      tx,
      sql`with med as (
            select qi.rfq_item_id, percentile_cont(0.5) within group (order by qi.unit_price * (1 - qi.discount_pct / 100)) as med, count(*) as n
            from quotation_items qi join quotations q on q.id = qi.quotation_id
            where q.buyer_org_id = ${org} and q.status = 'submitted' and q.is_current and qi.offered and not qi.is_alternative and qi.unit_price > 0
            group by qi.rfq_item_id)
          select sum((m.med - al.unit_price) * al.quantity) as s, sum(m.med * al.quantity) as base
          from award_lines al join awards a on a.id = al.award_id join med m on m.rfq_item_id = al.rfq_item_id
          where al.org_id = ${org} and al.is_current and a.status = 'approved' and m.n >= 2`,
    );
    const onTime = await one<{ ok: number; all: number }>(
      tx,
      sql`select count(*) filter (where last_receipt <= expected_delivery_at + interval '1 day')::int as ok, count(*)::int as all from (
            select p.expected_delivery_at, (select max(g.created_at) from goods_receipts g where g.po_id = p.id) as last_receipt
            from purchase_orders p where p.org_id = ${org} and p.fulfillment_status in ('delivered','completed') and p.expected_delivery_at is not null) x
          where last_receipt is not null`,
    );
    const top = await many<{ name_ar: string; name_en: string; v: string; n: number }>(
      tx,
      sql`select o.name_ar, o.name_en, sum(p.total) as v, count(*)::int as n from purchase_orders p join organizations o on o.id = p.supplier_org_id
          where p.org_id = ${org} and p.approval_status = 'approved' and p.fulfillment_status <> 'cancelled' group by 1, 2 order by 3 desc limit 5`,
    );
    const store = await one<{ v: string; n: number }>(tx, sql`select coalesce(sum(total - refunded_total),0) as v, count(*)::int as n from orders where org_id = ${org} and payment_status in ('paid','partially_refunded','refunded')`);
    const approvals = await one<{ pending: number; hours: string | null }>(
      tx,
      sql`select count(*) filter (where status = 'pending')::int as pending,
                 percentile_cont(0.5) within group (order by extract(epoch from (decided_at - created_at)) / 3600) filter (where decided_at is not null) as hours
          from approval_requests where org_id = ${org}`,
    );
    const s = num(savings.s);
    const base = num(savings.base); // ratios only; amounts below are formatted from the exact SQL numerics
    return {
      spendByMonth: fillMonths(spendRows, months),
      poCount: num(po.n),
      poValue: money(po.v),
      rfqsSent: num(rfq.sent),
      openRfqs: num(rfq.open),
      responseRatePct: pct(num(rfq.responded), num(rfq.recipients)),
      quotesPerRfq: num(rfq.sent) ? Math.round((num(rfq.quotes) / num(rfq.sent)) * 10) / 10 : null,
      medianCycleDays: cycle.d === null || cycle.d === undefined ? null : Math.round(num(cycle.d) * 10) / 10,
      savings: money(savings.s),
      savingsPct: pct(s, base),
      onTimePct: pct(num(onTime.ok), num(onTime.all)),
      deliveredPos: num(onTime.all),
      topSuppliers: top.map((t) => ({ nameAr: t.name_ar, nameEn: t.name_en, value: money(t.v), pos: num(t.n) })),
      storeSpend: money(store.v),
      storeOrders: num(store.n),
      pendingApprovals: num(approvals.pending),
      medianApprovalHours: approvals.hours === null || approvals.hours === undefined ? null : Math.round(num(approvals.hours) * 10) / 10,
    };
  });
}

export async function supplierKpis(ctx: Ctx, opts: { months?: number } = {}) {
  requireOrg(ctx, "supplier");
  authorize(ctx, "supplier.analytics.view");
  const months = Math.min(Math.max(opts.months ?? 12, 1), 36);
  const org = ctx.orgId;
  return withContext(dbCtx(ctx), async (tx) => {
    const rfq = await one<{ received: number; responded: number; declined: number }>(
      tx,
      sql`select count(*) filter (where status in ('sent','responded','declined'))::int as received, count(*) filter (where status = 'responded')::int as responded, count(*) filter (where status = 'declined')::int as declined
          from rfq_recipients where supplier_org_id = ${org}`,
    );
    const quoted = await one<{ lines: number; v: string }>(
      tx,
      sql`select count(distinct qi.rfq_item_id)::int as lines, coalesce((select sum(total) from quotations where supplier_org_id = ${org} and status = 'submitted' and is_current), 0) as v
          from quotation_items qi join quotations q on q.id = qi.quotation_id where q.supplier_org_id = ${org} and q.status in ('submitted','superseded') and qi.offered`,
    );
    const won = await one<{ lines: number }>(tx, sql`select count(distinct pi.rfq_item_id)::int as lines from po_items pi join purchase_orders p on p.id = pi.po_id where p.supplier_org_id = ${org} and p.approval_status = 'approved' and pi.rfq_item_id is not null`);
    const po = await one<{ n: number; v: string }>(tx, sql`select count(*)::int as n, coalesce(sum(total),0) as v from purchase_orders where supplier_org_id = ${org} and approval_status = 'approved' and fulfillment_status <> 'cancelled'`);
    const onTime = await one<{ ok: number; all: number }>(
      tx,
      sql`select count(*) filter (where shipped <= expected_delivery_at + interval '1 day')::int as ok, count(*)::int as all from (
            select p.expected_delivery_at, (select max(s.shipped_at) from shipments s where s.po_id = p.id) as shipped
            from purchase_orders p where p.supplier_org_id = ${org} and p.approval_status = 'approved' and p.expected_delivery_at is not null) x where shipped is not null`,
    );
    const store = await one<{ n: number; v: string; delivered: number; returns: number; cancelled: number }>(
      tx,
      sql`select count(*) filter (where status not in ('awaiting_payment','cancelled'))::int as n,
                 coalesce(sum(total - refunded_total) filter (where status not in ('awaiting_payment','cancelled')), 0) as v,
                 count(*) filter (where status in ('delivered','completed'))::int as delivered,
                 (select count(*) from return_requests r where r.supplier_org_id = ${org})::int as returns,
                 count(*) filter (where status = 'cancelled' and cancelled_by = 'supplier')::int as cancelled
          from order_groups where supplier_org_id = ${org}`,
    );
    const salesRows = await many<{ m: string; v: string }>(
      tx,
      sql`select m, sum(v) as v from (
            select to_char(date_trunc('month', issued_at), 'YYYY-MM') as m, total as v from purchase_orders
              where supplier_org_id = ${org} and approval_status = 'approved' and fulfillment_status <> 'cancelled' and issued_at > date_trunc('month', now()) - make_interval(months => ${months - 1})
            union all
            select to_char(date_trunc('month', confirmed_at), 'YYYY-MM'), total - refunded_total from order_groups
              where supplier_org_id = ${org} and status not in ('awaiting_payment','cancelled') and confirmed_at > date_trunc('month', now()) - make_interval(months => ${months - 1})
          ) x group by m`,
    );
    return {
      salesByMonth: fillMonths(salesRows, months),
      rfqsReceived: num(rfq.received),
      responseRatePct: pct(num(rfq.responded), num(rfq.received)),
      declined: num(rfq.declined),
      quotedLines: num(quoted.lines),
      quotedValue: money(quoted.v),
      winRatePct: pct(num(won.lines), num(quoted.lines)),
      poCount: num(po.n),
      poValue: money(po.v),
      onTimeShipPct: pct(num(onTime.ok), num(onTime.all)),
      storeOrders: num(store.n),
      storeSales: money(store.v),
      returnRatePct: pct(num(store.returns), num(store.delivered)),
      supplierCancellations: num(store.cancelled),
    };
  });
}

/** Platform overview for admins; test/demo organizations are excluded everywhere. */
export async function platformKpis(ctx: Ctx, opts: { months?: number } = {}) {
  authorizeAdmin(ctx, "admin.reports");
  const months = Math.min(Math.max(opts.months ?? 12, 1), 36);
  return withSystem(async (tx) => {
    const orgs = await one<{ buyers: number; suppliers: number; approved: number; test: number }>(
      tx,
      sql`select count(*) filter (where type = 'buyer' and not is_test_data)::int as buyers,
                 count(*) filter (where type = 'supplier' and not is_test_data)::int as suppliers,
                 (select count(*) from supplier_profiles sp join organizations o on o.id = sp.org_id where sp.status = 'approved' and not o.is_test_data)::int as approved,
                 count(*) filter (where is_test_data)::int as test
          from organizations`,
    );
    const users = await one<{ n: number }>(tx, sql`select count(*)::int as n from auth_users`);
    const proc = await one<{ rfqs: number; pos: number; po_value: string }>(
      tx,
      sql`select (select count(*) from rfqs r join organizations b on b.id = r.org_id where r.sent_at is not null and not b.is_test_data)::int as rfqs,
                 count(*)::int as pos, coalesce(sum(p.total),0) as po_value
          from purchase_orders p join organizations b on b.id = p.org_id join organizations s on s.id = p.supplier_org_id
          where p.approval_status = 'approved' and p.fulfillment_status <> 'cancelled' and not b.is_test_data and not s.is_test_data`,
    );
    const store = await one<{ orders: number; gmv: string; refunds: string }>(
      tx,
      sql`select count(distinct o.id)::int as orders, coalesce(sum(g.total),0) as gmv, coalesce(sum(g.refunded_total),0) as refunds
          from order_groups g join orders o on o.id = g.order_id join organizations s on s.id = g.supplier_org_id left join organizations b on b.id = o.org_id
          where o.payment_status in ('paid','partially_refunded','refunded') and not s.is_test_data and not coalesce(b.is_test_data, false) and not o.is_test_data`,
    );
    const gmvRows = await many<{ m: string; v: string }>(
      tx,
      sql`select to_char(date_trunc('month', o.placed_at), 'YYYY-MM') as m, sum(g.total) as v
          from order_groups g join orders o on o.id = g.order_id join organizations s on s.id = g.supplier_org_id left join organizations b on b.id = o.org_id
          where o.placed_at is not null and o.placed_at > date_trunc('month', now()) - make_interval(months => ${months - 1})
            and not s.is_test_data and not coalesce(b.is_test_data, false) and not o.is_test_data
          group by 1`,
    );
    const poRows = await many<{ m: string; v: string }>(
      tx,
      sql`select to_char(date_trunc('month', p.issued_at), 'YYYY-MM') as m, sum(p.total) as v
          from purchase_orders p join organizations b on b.id = p.org_id join organizations s on s.id = p.supplier_org_id
          where p.approval_status = 'approved' and p.issued_at > date_trunc('month', now()) - make_interval(months => ${months - 1}) and not b.is_test_data and not s.is_test_data
          group by 1`,
    );
    const orders = num(store.orders);
    return {
      buyerOrgs: num(orgs.buyers),
      supplierOrgs: num(orgs.suppliers),
      approvedSuppliers: num(orgs.approved),
      testOrgsExcluded: num(orgs.test),
      users: num(users.n),
      rfqsSent: num(proc.rfqs),
      poCount: num(proc.pos),
      poValue: money(proc.po_value),
      storeOrders: orders,
      storeGmv: money(store.gmv),
      storeRefunds: money(store.refunds),
      averageOrderValue: orders ? dec(String(store.gmv ?? 0)).div(orders).toFixed(2) : null,
      gmvByMonth: fillMonths(gmvRows, months),
      poByMonth: fillMonths(poRows, months),
    };
  });
}
