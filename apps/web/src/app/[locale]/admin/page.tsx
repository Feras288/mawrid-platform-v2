import { Building2, ClipboardCheck, FileText, Gauge, ListChecks, Settings, ShoppingBag, Users, Wallet } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { platformKpis } from "@platform/modules/analytics";
import { listSuppliersForAdmin } from "@platform/modules/suppliers";
import { monthPoints } from "@/components/analytics/month-points";
import { ColumnChart } from "@/components/charts/charts";
import { QuickActions } from "@/components/ui/dashboard";
import { buttonVariants, Card, CardBody, CardHeader, PageHeader, Stat } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireAdminCtx } from "@/lib/ctx";
import { cn } from "@/lib/utils";

export default async function AdminHome() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const [pending, review, approved, k] = await Promise.all([
    listSuppliersForAdmin(ctx, { status: "pending_verification" }),
    listSuppliersForAdmin(ctx, { status: "under_review" }),
    listSuppliersForAdmin(ctx, { status: "approved" }),
    platformKpis(ctx, { months: 6 }).catch(() => null),
  ]);
  const money = (v: string | number) => f.number(Number(v), { style: "currency", currency: "SAR", maximumFractionDigits: 0 });
  const queue = [
    { label: t("supplier.status.pending_verification"), value: pending.total, href: "/admin/suppliers?status=pending_verification", tone: "bg-info-600" },
    { label: t("supplier.status.under_review"), value: review.total, href: "/admin/suppliers?status=under_review", tone: "bg-warning-600" },
    { label: t("supplier.status.approved"), value: approved.total, href: "/admin/suppliers?status=approved", tone: "bg-success-600" },
  ];
  return (
    <>
      <PageHeader
        title={t("admin.title")}
        actions={
          <Link href="/admin/suppliers?status=pending_verification" className={buttonVariants()}>
            {t("admin.review")}
          </Link>
        }
      />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Stat label={t("supplier.status.pending_verification")} value={pending.total} tone="primary" icon={<ClipboardCheck />} />
          {k ? (
            <>
              <Stat label={t("adm.buyers")} value={k.buyerOrgs} hint={`${t("adm.users")}: ${k.users}`} icon={<Building2 />} />
              <Stat label={t("adm.gmv")} value={<bdi dir="ltr">{money(k.storeGmv)}</bdi>} hint={`${t("analytics.storeOrders")}: ${k.storeOrders}`} icon={<ShoppingBag />} />
              <Stat label={t("adm.poValue")} value={<bdi dir="ltr">{money(k.poValue)}</bdi>} hint={`${t("adm.pos")}: ${k.poCount}`} icon={<Wallet />} />
            </>
          ) : null}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1.5fr]">
          <Card className="overflow-hidden">
            <CardHeader title={t("ux.dash.supplierQueue")} />
            <ul className="divide-y divide-sand-100">
              {queue.map((q) => (
                <li key={q.href}>
                  <Link href={q.href} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-primary-50/40 sm:px-6">
                    <span className={cn("size-2.5 rounded-full", q.tone)} aria-hidden />
                    <span className="flex-1 text-sm font-semibold text-ink-800">{q.label}</span>
                    <span className="text-xl font-extrabold text-ink-900 tabular-nums">{q.value}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {k ? (
            <Card>
              <CardHeader title={t("adm.gmvByMonth")} actions={<Link href="/admin/reports" className="text-sm font-semibold text-primary-700 hover:underline">{t("ux.dash.viewAll")}</Link>} />
              <CardBody>
                <ColumnChart title={t("adm.gmvByMonth")} points={monthPoints(k.gmvByMonth, ctx.locale)} locale={ctx.locale} tableLabel={t("analytics.tableView")} valueHeader={t("analytics.value")} height={180} />
                <p className="mt-3 text-xs text-ink-500">{t("analytics.dataNote")}</p>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div>
          <h2 className="mb-3 text-h3 font-bold text-ink-900">{t("ux.dash.adminShortcuts")}</h2>
          <QuickActions
            items={[
              { href: "/admin/users", label: t("nav.users"), icon: <Users /> },
              { href: "/admin/store-orders", label: t("nav.storeOrders"), icon: <ShoppingBag /> },
              { href: "/admin/finance", label: t("nav.finance"), icon: <Wallet /> },
              { href: "/admin/jobs", label: t("nav.jobs"), icon: <Gauge /> },
              { href: "/admin/integrations", label: t("nav.integrations"), icon: <Settings /> },
              { href: "/admin/audit", label: t("nav.audit"), icon: <ListChecks /> },
              { href: "/admin/content", label: t("nav.content"), icon: <FileText /> },
              { href: "/admin/reports", label: t("nav.reports"), icon: <Gauge /> },
            ]}
          />
        </div>
      </div>
    </>
  );
}
