import { getFormatter, getTranslations } from "next-intl/server";
import { listPolicies } from "@platform/modules/approvals";
import { listAssignableRoles } from "@platform/modules/organizations";
import { projectOptions } from "@platform/modules/projects";
import { PolicyDialog } from "@/components/procurement/approval-client";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireOrgCtx } from "@/lib/ctx";
import { localized } from "@/lib/utils";

export default async function PoliciesPage() {
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const [policies, roles, projects] = await Promise.all([listPolicies(ctx), listAssignableRoles(ctx), projectOptions(ctx)]);
  const roleOpts = roles.map((r) => ({ value: r.key, label: localized(r, ctx.locale) }));
  const projOpts = projects.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }));
  const money = (v: string | null) => (v ? f.number(Number(v), { style: "currency", currency: "SAR" }) : "—");
  return (
    <>
      <PageHeader title={t("policies.title")} actions={<PolicyDialog roles={roleOpts} projects={projOpts} />} />
      <Card>
        {policies.length === 0 ? (
          <EmptyState title={t("policies.noPolicies")} />
        ) : (
          <Table caption={t("policies.title")}>
            <thead>
              <tr>
                <Th>{t("policies.name")}</Th>
                <Th>{t("policies.operation")}</Th>
                <Th>{t("policies.minAmount")}</Th>
                <Th>{t("policies.maxAmount")}</Th>
                <Th>{t("policies.steps")}</Th>
                <Th>{t("common.status")}</Th>
                <Th>{t("common.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <Tr key={p.id}>
                  <Td className="font-medium">
                    {p.name}
                    {p.projectId ? <span className="block text-xs text-ink-500">{projOpts.find((o) => o.value === p.projectId)?.label}</span> : null}
                  </Td>
                  <Td>{t(`approvals.ops.${p.operation as "award"}`)}</Td>
                  <Td dir="ltr">{money(p.minAmount)}</Td>
                  <Td dir="ltr">{money(p.maxAmount)}</Td>
                  <Td className="text-xs">
                    {p.steps.map((s) => (
                      <span key={s.id} className="block">
                        {s.stepOrder}. {s.name} ({roleOpts.find((r) => r.value === s.requiredRoleKey)?.label ?? t("policies.anyRole")} × {s.minApprovals})
                      </span>
                    ))}
                  </Td>
                  <Td>
                    <Badge tone={p.isActive ? "success" : "neutral"}>{p.isActive ? t("policies.active") : t("common.inactive")}</Badge>
                  </Td>
                  <Td>
                    <PolicyDialog policy={{ ...p, steps: p.steps.map((s) => ({ stepOrder: s.stepOrder, name: s.name, requiredRoleKey: s.requiredRoleKey, minApprovals: s.minApprovals })) }} roles={roleOpts} projects={projOpts} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
