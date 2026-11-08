import { getFormatter, getTranslations } from "next-intl/server";
import { listOrgAudit } from "@platform/modules/audit";
import { can, permissionsForOrgType } from "@platform/modules/authz";
import type { Ctx } from "@platform/modules/context";
import { listAssignableRoles, listInvitations, listMembers } from "@platform/modules/organizations";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { Pagination } from "@/components/ui/pagination";
import { localized } from "@/lib/utils";
import { CreateRoleDialog, DeleteRoleButton, InviteDialog, MemberActions, RevokeInviteButton } from "./team-client";

export const permLabelKey = (p: string) => `perms.${p.replace(/\./g, "_")}`;

export async function MembersPage({ ctx }: { ctx: Ctx }) {
  const t = await getTranslations();
  const f = await getFormatter();
  const [members, roles, invites] = await Promise.all([listMembers(ctx), listAssignableRoles(ctx), can(ctx, "members.manage") ? listInvitations(ctx) : Promise.resolve([])]);
  const manage = can(ctx, "members.manage");
  const roleOpts = roles.map((r) => ({ id: r.id, label: localized(r, ctx.locale), isSystem: r.isSystem }));
  const pending = invites.filter((i) => i.status === "pending");
  return (
    <>
      <PageHeader title={t("members.title")} actions={manage ? <InviteDialog roles={roleOpts} /> : null} />
      <Card>
        <Table caption={t("members.title")}>
          <thead>
            <tr>
              <Th>{t("members.member")}</Th>
              <Th>{t("members.roles")}</Th>
              <Th>{t("members.mfa")}</Th>
              <Th>{t("common.status")}</Th>
              {manage ? <Th className="text-end">{t("common.actions")}</Th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <Tr key={m.membershipId}>
                <Td>
                  <p className="font-medium text-ink-900">
                    {m.user?.name} {m.userId === ctx.userId ? <Badge tone="info">{t("members.you")}</Badge> : null}
                  </p>
                  <p className="text-xs text-ink-500" dir="ltr">{m.user?.email}</p>
                </Td>
                <Td>{m.roles.map((r) => localized(r, ctx.locale)).join("، ")}</Td>
                <Td>{m.user?.twoFactorEnabled ? <Badge tone="success">{t("account.twoFactorOn")}</Badge> : <Badge>{t("account.twoFactorOff")}</Badge>}</Td>
                <Td>
                  <Badge tone={m.status === "active" ? "success" : "warning"}>{t(`members.status.${m.status as "active"}`)}</Badge>
                </Td>
                {manage ? (
                  <Td className="text-end">
                    <MemberActions membershipId={m.membershipId} status={m.status} roles={roleOpts} current={m.roles.map((r) => r.roleId)} isSelf={m.userId === ctx.userId} />
                  </Td>
                ) : null}
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
      {manage && pending.length > 0 ? (
        <Card className="mt-6">
          <CardHeader title={t("members.pendingInvites")} />
          <Table caption={t("members.pendingInvites")}>
            <thead>
              <tr>
                <Th>{t("common.email")}</Th>
                <Th>{t("members.expiresAt")}</Th>
                <Th className="text-end">{t("common.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {pending.map((i) => (
                <Tr key={i.id}>
                  <Td dir="ltr" className="text-start">{i.email}</Td>
                  <Td>{f.dateTime(i.expiresAt, "short")}</Td>
                  <Td className="text-end">
                    <RevokeInviteButton id={i.id} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}

export async function RolesPage({ ctx }: { ctx: Ctx }) {
  const t = await getTranslations();
  const roles = await listAssignableRoles(ctx);
  const perms = permissionsForOrgType(ctx.orgType!).filter((p) => ctx.permissions.has(p));
  const label = (p: string) => (t.has(permLabelKey(p)) ? t(permLabelKey(p)) : p);
  return (
    <>
      <PageHeader title={t("roles.title")} actions={<CreateRoleDialog permissions={perms.map((p) => ({ key: p, label: label(p) }))} />} />
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((r) => (
          <Card key={r.id}>
            <CardHeader
              title={localized(r, ctx.locale)}
              description={<Badge tone={r.isSystem ? "neutral" : "accent"}>{r.isSystem ? t("roles.system") : t("roles.custom")}</Badge>}
              actions={!r.isSystem ? <DeleteRoleButton id={r.id} /> : null}
            />
            <ul className="flex flex-wrap gap-1.5 px-5 py-4">
              {r.permissions.map((p) => (
                <li key={p}>
                  <Badge tone="primary">{label(p)}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}

export async function AuditPage({ ctx, page }: { ctx: Ctx; page: number }) {
  const t = await getTranslations();
  const f = await getFormatter();
  const data = await listOrgAudit(ctx, { page });
  return (
    <>
      <PageHeader title={t("nav.audit")} />
      <Card>
        {data.items.length === 0 ? (
          <EmptyState title={t("common.none")} />
        ) : (
          <Table caption={t("nav.audit")}>
            <thead>
              <tr>
                <Th>{t("common.date")}</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Actor</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <Tr key={a.id}>
                  <Td className="whitespace-nowrap">{f.dateTime(a.createdAt, "long")}</Td>
                  <Td>
                    <code className="text-xs" dir="ltr">{a.action}</code>
                  </Td>
                  <Td>
                    <code className="text-xs" dir="ltr">
                      {a.entityType}
                      {a.entityId ? `:${a.entityId.slice(0, 8)}` : ""}
                    </code>
                  </Td>
                  <Td>
                    <code className="text-xs" dir="ltr">{a.actorType}{a.actorUserId ? `:${a.actorUserId.slice(0, 8)}` : ""}</code>
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
