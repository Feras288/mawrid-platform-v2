import { FolderKanban } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { can } from "@platform/modules/authz";
import { listMembers } from "@platform/modules/organizations";
import { listProjects, PROJECT_STATUSES } from "@platform/modules/projects";
import { listCities } from "@platform/modules/reference";
import { ProjectDialog } from "@/components/procurement/project-forms";
import { Pagination } from "@/components/ui/pagination";
import { Badge, buttonVariants, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const sp = await searchParams;
  const [data, members, cities] = await Promise.all([listProjects(ctx, { q: sp.q, status: sp.status || undefined, page: Number(sp.page) || 1 }), listMembers(ctx), listCities()]);
  const memberOpts = members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.user?.name ?? m.userId }));
  const cityOpts = cities.map((c) => ({ value: c.code, label: localized(c, ctx.locale) }));
  return (
    <>
      <PageHeader title={t("projects.title")} actions={can(ctx, "project.create") ? <ProjectDialog members={memberOpts} cities={cityOpts} /> : null} />
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-sand-200 p-4" role="search">
          <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("common.search")} aria-label={t("common.search")} className="max-w-xs" />
          <Select name="status" defaultValue={sp.status ?? ""} aria-label={t("projects.status")} className="max-w-48">
            <option value="">{t("common.all")}</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`projects.statuses.${s}`)}
              </option>
            ))}
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>{t("common.filter")}</button>
        </form>
        {data.items.length === 0 ? (
          <EmptyState icon={<FolderKanban />} title={t("projects.noProjects")} />
        ) : (
          <Table caption={t("projects.title")}>
            <thead>
              <tr>
                <Th>{t("projects.code")}</Th>
                <Th>{t("projects.name")}</Th>
                <Th>{t("projects.type")}</Th>
                <Th>{t("projects.city")}</Th>
                <Th>{t("projects.status")}</Th>
                <Th>{t("common.createdAt")}</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <Tr key={p.id}>
                  <Td dir="ltr" className="font-mono text-xs">
                    {p.code}
                  </Td>
                  <Td>
                    <Link href={`/org/projects/${p.id}`} className="font-medium text-primary-700 hover:underline">
                      {p.name}
                    </Link>
                    {p.visibility === "members" ? <Badge className="ms-2">{t("projects.visibilityOptions.members")}</Badge> : null}
                  </Td>
                  <Td>{t(`projects.types.${p.projectType as "other"}`)}</Td>
                  <Td>{cityOpts.find((c) => c.value === p.city)?.label ?? p.city ?? "—"}</Td>
                  <Td>
                    <Badge tone={p.status === "active" ? "success" : p.status === "cancelled" ? "danger" : "info"}>{t(`projects.statuses.${p.status as "planning"}`)}</Badge>
                  </Td>
                  <Td>{f.dateTime(p.createdAt, "short")}</Td>
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
