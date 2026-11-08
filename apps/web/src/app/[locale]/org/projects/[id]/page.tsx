import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { can } from "@platform/modules/authz";
import { listBoqs } from "@platform/modules/boq";
import { listMembers } from "@platform/modules/organizations";
import { getProject } from "@platform/modules/projects";
import { listCities } from "@platform/modules/reference";
import { BoqUploadDialog, ManualBoqDialog, ProjectDialog, ProjectMemberDialog } from "@/components/procurement/project-forms";
import { Badge, Card, CardBody, CardHeader, Dl, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";
import { formatMoney } from "@platform/core";
import { localized } from "@/lib/utils";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const data = await getProject(ctx, id).catch(() => notFound());
  const [members, cities, boqs] = await Promise.all([listMembers(ctx), listCities(), can(ctx, "boq.view") ? listBoqs(ctx, { projectId: id }) : Promise.resolve({ items: [] })]);
  const p = data.project;
  const memberOpts = members.filter((m) => m.status === "active").map((m) => ({ value: m.userId, label: m.user?.name ?? m.userId }));
  const cityOpts = cities.map((c) => ({ value: c.code, label: localized(c, ctx.locale) }));
  return (
    <>
      <PageHeader
        title={p.name}
        breadcrumbs={
          <>
            <Link href="/org/projects" className="hover:underline">
              {t("projects.title")}
            </Link>{" "}
            / <span dir="ltr">{p.code}</span>
          </>
        }
        actions={
          <>
            <Badge tone={p.status === "active" ? "success" : "info"}>{t(`projects.statuses.${p.status as "planning"}`)}</Badge>
            {can(ctx, "project.update") ? <ProjectDialog project={p} members={memberOpts} cities={cityOpts} /> : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody>
              <Dl
                items={[
                  { label: t("projects.type"), value: t(`projects.types.${p.projectType as "other"}`) },
                  { label: t("projects.city"), value: cityOpts.find((c) => c.value === p.city)?.label ?? p.city },
                  { label: t("projects.manager"), value: memberOpts.find((m) => m.value === p.managerUserId)?.label },
                  { label: t("projects.budget"), value: p.budget ? formatMoney(p.budget, ctx.locale) : null },
                  { label: t("projects.startDate"), value: p.startDate ? f.dateTime(p.startDate, "short") : null },
                  { label: t("projects.endDate"), value: p.endDate ? f.dateTime(p.endDate, "short") : null },
                  { label: t("projects.siteAddress"), value: p.siteAddress },
                  { label: t("projects.description"), value: p.description },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title={t("projects.boqs")}
              actions={
                can(ctx, "boq.upload") ? (
                  <>
                    <ManualBoqDialog projects={[]} projectId={p.id} />
                    <BoqUploadDialog projects={[]} projectId={p.id} />
                  </>
                ) : null
              }
            />
            {boqs.items.length === 0 ? (
              <EmptyState title={t("boq.noBoqs")} />
            ) : (
              <Table caption={t("projects.boqs")}>
                <thead>
                  <tr>
                    <Th>{t("projects.code")}</Th>
                    <Th>{t("boq.titleField")}</Th>
                    <Th>{t("common.status")}</Th>
                    <Th>{t("boq.lines")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {boqs.items.map((b) => (
                    <Tr key={b.id}>
                      <Td dir="ltr" className="font-mono text-xs">
                        {b.code}
                      </Td>
                      <Td>
                        <Link href={`/org/boq/${b.id}`} className="text-primary-700 hover:underline">
                          {b.title}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={b.status === "approved" ? "success" : b.status === "failed" ? "danger" : "info"}>{t(`boq.status.${b.status as "received"}`)}</Badge>
                      </Td>
                      <Td>{b.stats.lines ?? 0}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title={t("projects.members")} actions={can(ctx, "project.manage_members") ? <ProjectMemberDialog projectId={p.id} users={memberOpts} /> : null} />
            <CardBody>
              <ul className="space-y-2 text-sm">
                {data.members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-2">
                    <span>{m.name}</span>
                    <Badge>{t(`projects.roles.${m.role as "member"}`)}</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t("projects.activity")} />
            <CardBody>
              <ol className="space-y-3 text-sm">
                {data.activity.map((a) => (
                  <li key={a.id} className="border-s-2 border-primary-200 ps-3">
                    <p>{t.has(`projects.actions.${a.action.replace(/\./g, "_")}`) ? t(`projects.actions.${a.action.replace(/\./g, "_")}` as "projects.actions.project_created") : a.action}</p>
                    <time className="text-xs text-ink-400">{f.dateTime(a.createdAt, "long")}</time>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
