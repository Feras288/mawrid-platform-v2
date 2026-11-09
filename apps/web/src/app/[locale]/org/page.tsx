import { CheckSquare, ClipboardList, FileSpreadsheet, FileText, FolderPlus, Hourglass, Send, TrendingUp, Wallet } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { buyerKpis } from "@platform/modules/analytics";
import { can } from "@platform/modules/authz";
import { getOrganization } from "@platform/modules/organizations";
import { listPos } from "@platform/modules/purchase-orders";
import { listRfqs } from "@platform/modules/rfq";
import { monthPoints } from "@/components/analytics/month-points";
import { ColumnChart } from "@/components/charts/charts";
import { toneFor } from "@/components/procurement/status";
import { ActivityList, QuickActions } from "@/components/ui/dashboard";
import { Badge, Card, CardBody, CardHeader, Dl, PageHeader, Stat } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function OrgDashboard() {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const canKpi = can(ctx, "analytics.view");
  const canRfq = can(ctx, "rfq.view");
  const canPo = can(ctx, "po.view");
  const [org, k, rfqs, pos] = await Promise.all([
    getOrganization(ctx),
    canKpi ? buyerKpis(ctx, { months: 6 }) : Promise.resolve(null),
    canRfq ? listRfqs(ctx, { page: 1 }) : Promise.resolve(null),
    canPo ? listPos(ctx, { side: "buyer", page: 1 }) : Promise.resolve(null),
  ]);
  const money = (v: string | number) => f.number(Number(v), { style: "currency", currency: "SAR", maximumFractionDigits: 0 });
  const actions = [
    can(ctx, "project.create") ? { href: "/org/projects", label: t("ux.dash.newProject"), icon: <FolderPlus />, primary: true } : null,
    can(ctx, "boq.view") ? { href: "/org/boq", label: t("ux.dash.uploadBoq"), icon: <FileSpreadsheet /> } : null,
    canRfq ? { href: "/org/rfqs", label: t("ux.dash.newRfq"), icon: <Send /> } : null,
    { href: "/org/approvals", label: t("ux.dash.reviewApprovals"), icon: <CheckSquare /> },
  ].filter((x): x is NonNullable<typeof x> => Boolean(x));
  const viewAll = (href: string) => (
    <Link href={href} className="text-sm font-semibold text-primary-700 hover:underline">
      {t("ux.dash.viewAll")}
    </Link>
  );
  return (
    <>
      <PageHeader title={localized(org, ctx.locale)} description={t("nav.procurement")} />
      <div className="space-y-6">
        {k ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <Stat label={t("analytics.openRfqs")} value={k.openRfqs} icon={<ClipboardList />} tone="primary" />
            <Stat label={t("analytics.pendingApprovals")} value={k.pendingApprovals} icon={<Hourglass />} />
            <Stat label={t("analytics.poValue")} value={<bdi dir="ltr">{money(k.poValue)}</bdi>} hint={`${t("analytics.poCount")}: ${k.poCount}`} icon={<Wallet />} />
            <Stat label={t("analytics.responseRate")} value={k.responseRatePct === null ? "—" : `${k.responseRatePct}%`} hint={`${t("analytics.rfqsSent")}: ${k.rfqsSent}`} icon={<TrendingUp />} />
          </div>
        ) : null}

        <QuickActions items={actions} />

        <div className="grid gap-6 xl:grid-cols-2">
          {rfqs ? (
            <Card className="overflow-hidden">
              <CardHeader title={t("ux.dash.recentRfqs")} actions={viewAll("/org/rfqs")} />
              <ActivityList
                empty={t("rfq.noRfqs")}
                items={rfqs.items.slice(0, 5).map(({ rfq, responses, recipients }) => ({
                  id: rfq.id,
                  href: `/org/rfqs/${rfq.id}`,
                  title: rfq.title,
                  meta: (
                    <>
                      <bdi dir="ltr" className="font-mono">
                        {rfq.code}
                      </bdi>
                      {" · "}
                      {t("rfq.responses")}: {responses}/{recipients}
                    </>
                  ),
                  trailing: <Badge tone={toneFor(rfq.status)}>{t(`rfq.status.${rfq.status as "draft"}`)}</Badge>,
                }))}
              />
            </Card>
          ) : null}
          {pos ? (
            <Card className="overflow-hidden">
              <CardHeader title={t("ux.dash.recentPos")} actions={viewAll("/org/purchase-orders")} />
              <ActivityList
                empty={t("po.noPos")}
                items={pos.items.slice(0, 5).map(({ po, partyAr, partyEn }) => ({
                  id: po.id,
                  href: `/org/purchase-orders/${po.id}`,
                  title: (
                    <bdi dir="ltr" className="font-mono">
                      {po.code}
                    </bdi>
                  ),
                  meta: localized({ nameAr: partyAr, nameEn: partyEn }, ctx.locale),
                  trailing: (
                    <>
                      <bdi dir="ltr" className="hidden font-semibold text-ink-900 sm:inline">
                        {f.number(Number(po.total), { style: "currency", currency: po.currency })}
                      </bdi>
                      <Badge tone={toneFor(po.fulfillmentStatus)}>{t(`po.status.${po.fulfillmentStatus as "not_started"}`)}</Badge>
                    </>
                  ),
                }))}
              />
            </Card>
          ) : null}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          {k ? (
            <Card>
              <CardHeader title={t("analytics.spendByMonth")} actions={viewAll("/org/analytics")} />
              <CardBody>
                <ColumnChart title={t("analytics.spendByMonth")} points={monthPoints(k.spendByMonth, ctx.locale)} locale={ctx.locale} tableLabel={t("analytics.tableView")} valueHeader={t("analytics.value")} />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title={t("org.profile")} actions={can(ctx, "org.view") ? <Link href="/org/settings" className="text-sm font-semibold text-primary-700 hover:underline">{t("nav.orgSettings")}</Link> : null} />
            <CardBody>
              <Dl
                className="sm:grid-cols-2"
                items={[
                  { label: t("org.vatNumber"), value: org.vatNumber ? <bdi dir="ltr">{org.vatNumber}</bdi> : null },
                  { label: t("org.crNumber"), value: org.crNumber ? <bdi dir="ltr">{org.crNumber}</bdi> : null },
                  { label: t("common.city"), value: org.city },
                  { label: t("common.email"), value: org.email },
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader title={t("ux.dash.cycle")} description={t("ux.dash.cycleHint")} />
          <ol className="grid gap-px bg-sand-100 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: FileSpreadsheet, title: t("ux.b2b.step1"), body: t("ux.b2b.step1Body"), href: "/org/boq" },
              { icon: Send, title: t("ux.b2b.step2"), body: t("ux.b2b.step2Body"), href: "/org/rfqs" },
              { icon: ClipboardList, title: t("ux.b2b.step3"), body: t("ux.b2b.step3Body"), href: "/org/rfqs" },
              { icon: FileText, title: t("ux.b2b.step4"), body: t("ux.b2b.step4Body"), href: "/org/purchase-orders" },
            ].map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="bg-white p-5">
                <div className="flex items-center gap-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-accent-100 text-accent-700">
                    <Icon className="size-[1.125rem]" aria-hidden />
                  </span>
                  <span className="text-xs font-bold text-ink-400 tabular-nums" aria-hidden>
                    0{i + 1}
                  </span>
                </div>
                <p className="mt-3 text-sm font-bold text-ink-900">{title}</p>
                <p className="mt-1 text-xs leading-5 text-ink-500">{body}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
