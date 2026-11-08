import { getFormatter, getTranslations } from "next-intl/server";
import { listSuppliersForAdmin } from "@platform/modules/suppliers";
import { Pagination } from "@/components/ui/pagination";
import { Badge, buttonVariants, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireAdminCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

const STATUSES = ["new", "pending_verification", "under_review", "approved", "suspended", "rejected"] as const;
const TONE = { new: "neutral", pending_verification: "info", under_review: "warning", approved: "success", suspended: "danger", rejected: "danger" } as const;

export default async function AdminSuppliers({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as never) ? (sp.status as (typeof STATUSES)[number]) : undefined;
  const data = await listSuppliersForAdmin(ctx, { status, q: sp.q, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title={t("admin.suppliersTitle")} />
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-sand-200 p-4" role="search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("common.search")} aria-label={t("common.search")} className="max-w-xs" />
          <Select name="status" defaultValue={status ?? ""} aria-label={t("common.status")} className="max-w-56">
            <option value="">{t("common.all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`supplier.status.${s}`)}
              </option>
            ))}
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>{t("common.filter")}</button>
        </form>
        {data.items.length === 0 ? (
          <EmptyState title={t("common.none")} />
        ) : (
          <Table caption={t("admin.suppliersTitle")}>
            <thead>
              <tr>
                <Th>{t("common.name")}</Th>
                <Th>{t("org.crNumber")}</Th>
                <Th>{t("common.city")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("admin.submittedAt")}</Th>
                <Th className="text-end">{t("common.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <Tr key={s.orgId}>
                  <Td className="font-medium">
                    {localized(s, ctx.locale)} {s.isTestData ? <Badge tone="warning">{t("admin.testData")}</Badge> : null}
                  </Td>
                  <Td dir="ltr">{s.crNumber ?? "—"}</Td>
                  <Td>{s.city ?? "—"}</Td>
                  <Td>
                    <Badge tone={TONE[s.status as keyof typeof TONE] ?? "neutral"}>{t(`supplier.status.${s.status as "new"}`)}</Badge>
                  </Td>
                  <Td>{s.submittedAt ? f.dateTime(s.submittedAt, "short") : "—"}</Td>
                  <Td className="text-end">
                    <Link href={`/admin/suppliers/${s.orgId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                      {t("admin.review")}
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} />
      </Card>
    </>
  );
}
