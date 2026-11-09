import { ClipboardList, Inbox, PackagePlus, ShoppingBag, Store, Trophy, Upload, Wallet } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { supplierKpis } from "@platform/modules/analytics";
import { can } from "@platform/modules/authz";
import { listSupplierOrders } from "@platform/modules/commerce";
import { getOrganization } from "@platform/modules/organizations";
import { supplierInbox } from "@platform/modules/rfq";
import { listMyProducts } from "@platform/modules/supplier-products";
import { getMyProfile } from "@platform/modules/suppliers";
import { toneFor } from "@/components/procurement/status";
import { SupplierStatusCard } from "@/components/supplier/status-card";
import { ActivityList, Checklist, QuickActions } from "@/components/ui/dashboard";
import { Badge, Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function SupplierDashboard() {
  const ctx = await requireOrgCtx("supplier");
  const t = await getTranslations();
  const f = await getFormatter();
  const canProducts = can(ctx, "products.view");
  const [org, prof, all, published, k, inbox, orders] = await Promise.all([
    getOrganization(ctx),
    getMyProfile(ctx),
    canProducts ? listMyProducts(ctx, { pageSize: 1 }) : Promise.resolve({ total: 0 }),
    canProducts ? listMyProducts(ctx, { pageSize: 1, status: "active" }) : Promise.resolve({ total: 0 }),
    can(ctx, "supplier.analytics.view") ? supplierKpis(ctx, { months: 6 }) : Promise.resolve(null),
    can(ctx, "supplier.rfq.view") ? supplierInbox(ctx, { page: 1 }) : Promise.resolve(null),
    can(ctx, "supplier.orders.view") ? listSupplierOrders(ctx, { page: 1 }) : Promise.resolve(null),
  ]);
  const status = prof.profile.status;
  const money = (v: string | number) => f.number(Number(v), { style: "currency", currency: "SAR", maximumFractionDigits: 0 });
  const steps = [
    { label: t("ux.dash.stepProfile"), done: status !== "new" && status !== "rejected", href: "/supplier/profile" },
    { label: t("ux.dash.stepDocuments"), done: prof.documents.length > 0, href: "/supplier/documents" },
    { label: t("ux.dash.stepApproved"), done: status === "approved" },
    { label: t("ux.dash.stepProduct"), done: all.total > 0, href: "/supplier/products/new" },
    { label: t("ux.dash.stepPublished"), done: published.total > 0, href: "/supplier/products" },
  ];
  const ready = steps.every((s) => s.done);
  const actions = [
    can(ctx, "products.manage") ? { href: "/supplier/products/new", label: t("ux.dash.addProduct"), icon: <PackagePlus />, primary: true } : null,
    can(ctx, "products.manage") ? { href: "/supplier/imports", label: t("ux.dash.importProducts"), icon: <Upload /> } : null,
    inbox ? { href: "/supplier/rfqs", label: t("nav.rfqs"), icon: <Inbox /> } : null,
    orders ? { href: "/supplier/orders", label: t("nav.storeOrders"), icon: <ShoppingBag /> } : null,
  ].filter((x): x is NonNullable<typeof x> => Boolean(x));
  const viewAll = (href: string) => (
    <Link href={href} className="text-sm font-semibold text-primary-700 hover:underline">
      {t("ux.dash.viewAll")}
    </Link>
  );
  return (
    <>
      <PageHeader title={localized(org, ctx.locale)} description={t("nav.supplierPortal")} />
      <div className="space-y-6">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
          <SupplierStatusCard status={status} reason={prof.profile.statusReason} canSubmit={can(ctx, "supplier.profile.manage")} />
          {!ready ? (
            <Card>
              <CardHeader title={t("ux.dash.checklist")} description={t("ux.dash.checklistHint")} />
              <CardBody>
                <Checklist items={steps} doneLabel={t("ux.dash.done")} pendingLabel={t("ux.dash.pending")} />
              </CardBody>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <Stat label={t("supplier.dashboard.products")} value={all.total} icon={<Store />} />
              <Stat label={t("products.status.active")} value={published.total} icon={<Store />} tone="primary" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {!ready ? (
            <>
              <Stat label={t("supplier.dashboard.products")} value={all.total} icon={<Store />} />
              <Stat label={t("products.status.active")} value={published.total} icon={<Store />} tone="primary" />
            </>
          ) : null}
          {k ? (
            <>
              <Stat label={t("analytics.rfqsReceived")} value={k.rfqsReceived} icon={<ClipboardList />} hint={k.responseRatePct === null ? undefined : `${t("analytics.responseRate")}: ${k.responseRatePct}%`} />
              <Stat label={t("analytics.winRate")} value={k.winRatePct === null ? "—" : `${k.winRatePct}%`} icon={<Trophy />} />
              {ready ? (
                <>
                  <Stat label={t("analytics.poValue")} value={<bdi dir="ltr">{money(k.poValue)}</bdi>} hint={`${t("analytics.poCount")}: ${k.poCount}`} icon={<Wallet />} />
                  <Stat label={t("analytics.storeSales")} value={<bdi dir="ltr">{money(k.storeSales)}</bdi>} hint={`${t("analytics.storeOrders")}: ${k.storeOrders}`} icon={<ShoppingBag />} />
                </>
              ) : null}
            </>
          ) : null}
        </div>

        <QuickActions items={actions} />

        <div className="grid gap-6 xl:grid-cols-2">
          {inbox ? (
            <Card className="overflow-hidden">
              <CardHeader title={t("ux.dash.incomingRfqs")} actions={viewAll("/supplier/rfqs")} />
              <ActivityList
                empty={t("rfq.noRfqs")}
                items={inbox.items.slice(0, 5).map(({ rfq, buyerAr, buyerEn, quotationStatus, rc }) => ({
                  id: rc.id,
                  href: `/supplier/rfqs/${rfq.id}`,
                  title: rfq.title,
                  meta: (
                    <>
                      {localized({ nameAr: buyerAr, nameEn: buyerEn }, ctx.locale)}
                      {rfq.closesAt ? <> · {f.dateTime(rfq.closesAt, "short")}</> : null}
                    </>
                  ),
                  trailing: quotationStatus ? <Badge tone={toneFor(quotationStatus)}>{t(`quote.status.${quotationStatus as "draft"}`)}</Badge> : <Badge tone={toneFor(rfq.status)}>{t(`rfq.status.${rfq.status as "open"}`)}</Badge>,
                }))}
              />
            </Card>
          ) : null}
          {orders ? (
            <Card className="overflow-hidden">
              <CardHeader title={t("orders.supplierTitle")} actions={viewAll("/supplier/orders")} />
              <ActivityList
                empty={t("orders.noSupplierOrders")}
                items={orders.items.slice(0, 5).map((g) => ({
                  id: g.id,
                  href: `/supplier/orders/${g.id}`,
                  title: (
                    <bdi dir="ltr" className="font-mono">
                      {g.code}
                    </bdi>
                  ),
                  meta: f.dateTime(g.createdAt, "short"),
                  trailing: (
                    <>
                      <bdi dir="ltr" className="hidden font-semibold text-ink-900 sm:inline">
                        {f.number(Number(g.total), { style: "currency", currency: "SAR" })}
                      </bdi>
                      <Badge tone={toneFor(g.status)}>{t(`orders.groupStatus.${g.status as "confirmed"}`)}</Badge>
                    </>
                  ),
                }))}
              />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
