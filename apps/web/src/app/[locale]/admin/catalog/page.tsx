import { getTranslations } from "next-intl/server";
import { authorizeAdmin } from "@platform/modules/authz";
import { listCategories, listDuplicateCandidates, searchCanonical } from "@platform/modules/catalog";
import { listUnits } from "@platform/modules/reference";
import { DuplicateActions, NewCanonicalDialog, NewCategoryDialog, ToggleCategory } from "@/components/admin/catalog-client";
import { Tabs } from "@/components/ui/overlay";
import { Pagination } from "@/components/ui/pagination";
import { Badge, Card, CardHeader, EmptyState, Input, PageHeader, Table, Td, Th, Tr, buttonVariants } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function AdminCatalog({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const ctx = await requireAdminCtx();
  authorizeAdmin(ctx, "admin.catalog", { requireMfa: false });
  const t = await getTranslations();
  const sp = await searchParams;
  const [cats, units, canon, dups] = await Promise.all([listCategories({ includeInactive: true }), listUnits(), searchCanonical({ q: sp.q, page: Number(sp.page) || 1 }), listDuplicateCandidates(ctx)]);
  const roots = cats.filter((c) => c.depth === 0);
  return (
    <>
      <PageHeader title={t("catalog.title")} />
      <Tabs
        defaultValue={sp.q || sp.page ? "canonical" : "categories"}
        tabs={[
          {
            value: "categories",
            label: t("catalog.categories"),
            content: (
              <Card>
                <CardHeader title={t("catalog.categories")} actions={<NewCategoryDialog categories={cats} />} />
                <Table caption={t("catalog.categories")}>
                  <thead>
                    <tr>
                      <Th>{t("common.name")}</Th>
                      <Th>{t("catalog.system")}</Th>
                      <Th>{t("common.status")}</Th>
                      <Th className="text-end">{t("common.actions")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {roots.flatMap((r) => [r, ...cats.filter((c) => c.path.startsWith(`${r.path}/`))]).map((c) => (
                      <Tr key={c.id}>
                        <Td style={{ paddingInlineStart: `${0.75 + c.depth * 1.5}rem` }} className={c.depth === 0 ? "font-semibold text-primary-800" : undefined}>
                          {localized(c, ctx.locale)}
                        </Td>
                        <Td>{t(`catalog.systems.${c.system as "electrical"}`)}</Td>
                        <Td>
                          <Badge tone={c.isActive ? "success" : "neutral"}>{c.isActive ? t("supplier.active") : t("supplier.inactive")}</Badge>
                        </Td>
                        <Td className="text-end">
                          <ToggleCategory id={c.id} isActive={c.isActive} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            ),
          },
          {
            value: "canonical",
            label: t("catalog.canonical"),
            content: (
              <Card>
                <CardHeader title={t("catalog.canonical")} actions={<NewCanonicalDialog categories={cats} units={units} />} />
                <form className="flex gap-2 border-b border-sand-200 p-4" role="search">
                  <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("common.search")} aria-label={t("common.search")} className="max-w-sm" />
                  <button className={buttonVariants({ variant: "outline" })}>{t("common.search")}</button>
                </form>
                {canon.items.length === 0 ? (
                  <EmptyState title={t("common.none")} />
                ) : (
                  <Table caption={t("catalog.canonical")}>
                    <thead>
                      <tr>
                        <Th>{t("common.name")}</Th>
                        <Th>{t("products.category")}</Th>
                        <Th>{t("catalog.baseUnit")}</Th>
                        <Th>{t("products.attributes")}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {canon.items.map((p) => (
                        <Tr key={p.id}>
                          <Td className="font-medium">{localized(p, ctx.locale)}</Td>
                          <Td>{localized(cats.find((c) => c.id === p.categoryId), ctx.locale)}</Td>
                          <Td dir="ltr">{p.baseUnit}</Td>
                          <Td dir="ltr" className="text-xs text-ink-500">
                            {Object.entries(p.attributes)
                              .map(([k, v]) => `${k}=${v}`)
                              .join(" · ")}
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                <Pagination page={canon.page} pageSize={canon.pageSize} total={canon.total} />
              </Card>
            ),
          },
          {
            value: "duplicates",
            label: `${t("catalog.duplicates")} (${dups.length})`,
            content: (
              <Card>
                {dups.length === 0 ? (
                  <EmptyState title={t("catalog.noDuplicates")} />
                ) : (
                  <Table caption={t("catalog.duplicates")}>
                    <thead>
                      <tr>
                        <Th>A</Th>
                        <Th>B</Th>
                        <Th>{t("catalog.score")}</Th>
                        <Th className="text-end">{t("common.actions")}</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {dups.map((d) => (
                        <Tr key={d.id}>
                          <Td>{localized(d.a, ctx.locale)}</Td>
                          <Td>{localized(d.b, ctx.locale)}</Td>
                          <Td dir="ltr">
                            {Number(d.score).toFixed(2)}
                            <span className="block text-[11px] text-ink-400">{d.reasons.join(", ")}</span>
                          </Td>
                          <Td className="text-end">
                            <DuplicateActions id={d.id} aId={d.aId} bId={d.bId} />
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            ),
          },
        ]}
      />
    </>
  );
}
