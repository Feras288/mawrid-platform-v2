"use client";

import { useTranslations } from "next-intl";
import { createRoleAction, deleteRoleAction, inviteAction, revokeInviteAction, setRolesAction, setStatusAction } from "@/app/actions/team";
import { ActionButton, ActionForm, Field, FormError, SubmitButton } from "@/components/ui/form";
import { Menu, MenuItem, Modal } from "@/components/ui/overlay";
import { Button, Checkbox } from "@/components/ui/primitives";

type RoleOpt = { id: string; label: string; isSystem: boolean };

export function InviteDialog({ roles }: { roles: RoleOpt[] }) {
  const t = useTranslations();
  return (
    <Modal title={t("members.invite")} trigger={<Button>{t("members.invite")}</Button>}>
      <ActionForm action={inviteAction} successMessage={t("members.inviteSent")} resetOnSuccess>
        <FormError />
        <Field name="email" type="email" label={t("common.email")} required dir="ltr" />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink-700">{t("members.roles")}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <Checkbox key={r.id} name="roleIds[]" value={r.id} label={r.label} />
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end">
          <SubmitButton>{t("members.invite")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function MemberActions({ membershipId, status, roles, current, isSelf }: { membershipId: string; status: string; roles: RoleOpt[]; current: string[]; isSelf: boolean }) {
  const t = useTranslations();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Modal title={t("members.changeRoles")} trigger={<Button size="sm" variant="outline">{t("members.changeRoles")}</Button>}>
        <ActionForm action={setRolesAction} successMessage={t("members.rolesUpdated")}>
          <FormError />
          <input type="hidden" name="membershipId" value={membershipId} />
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <Checkbox key={r.id} name="roleIds[]" value={r.id} defaultChecked={current.includes(r.id)} label={r.label} />
            ))}
          </div>
          <div className="flex justify-end">
            <SubmitButton>{t("common.save")}</SubmitButton>
          </div>
        </ActionForm>
      </Modal>
      {!isSelf ? (
        <Menu trigger={<Button size="sm" variant="ghost" aria-label={t("common.actions")}>⋯</Button>}>
          {status === "active" ? (
            <MenuItem onSelect={() => void setStatusAction(membershipId, "suspended").then(() => location.reload())}>{t("members.suspend")}</MenuItem>
          ) : (
            <MenuItem onSelect={() => void setStatusAction(membershipId, "active").then(() => location.reload())}>{t("members.activate")}</MenuItem>
          )}
          <MenuItem
            className="text-danger-600"
            onSelect={() => {
              if (window.confirm(t("members.removeConfirm"))) void setStatusAction(membershipId, "removed").then(() => location.reload());
            }}
          >
            {t("common.remove")}
          </MenuItem>
        </Menu>
      ) : null}
    </div>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const t = useTranslations("members");
  return (
    <ActionButton size="sm" variant="ghost" action={() => revokeInviteAction(id)}>
      {t("revokeInvite")}
    </ActionButton>
  );
}

export function CreateRoleDialog({ permissions }: { permissions: { key: string; label: string }[] }) {
  const t = useTranslations();
  return (
    <Modal wide title={t("roles.createCustom")} trigger={<Button>{t("roles.createCustom")}</Button>}>
      <ActionForm action={createRoleAction} successMessage={t("roles.created")} resetOnSuccess>
        <FormError />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="nameAr" label={t("org.nameAr")} required dir="rtl" />
          <Field name="nameEn" label={t("org.nameEn")} required dir="ltr" />
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink-700">{t("roles.permissions")}</legend>
          <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
            {permissions.map((p) => (
              <Checkbox key={p.key} name="permissions[]" value={p.key} label={<span><span className="block">{p.label}</span><code className="text-[11px] text-ink-400" dir="ltr">{p.key}</code></span>} />
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end">
          <SubmitButton>{t("common.create")}</SubmitButton>
        </div>
      </ActionForm>
    </Modal>
  );
}

export function DeleteRoleButton({ id }: { id: string }) {
  const t = useTranslations();
  return (
    <ActionButton size="sm" variant="ghost" className="text-danger-600" confirm={t("common.delete") + "?"} successMessage={t("roles.deleted")} action={() => deleteRoleAction(id)}>
      {t("common.delete")}
    </ActionButton>
  );
}
