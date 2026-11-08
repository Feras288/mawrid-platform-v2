"use client";
import { Building2, Check, ChevronDown, LogOut, Shield, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { switchOrgAction } from "@/app/actions/session";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/overlay";

export function UserMenu({ name, activeOrgId, activeOrgLabel, orgs, isAdmin }: { name: string; activeOrgId: string | null; activeOrgLabel: string; orgs: { id: string; label: string; type: string }[]; isAdmin: boolean }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [, start] = useTransition();
  const switchTo = (orgId: string | null, type?: string) =>
    start(async () => {
      await switchOrgAction(orgId);
      router.push(type === "supplier" ? "/supplier" : type === "buyer" ? "/org" : "/account");
      router.refresh();
    });
  return (
    <Menu
      trigger={
        <button type="button" className="inline-flex max-w-56 items-center gap-2 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100">
          <Building2 className="size-4 text-ink-500" aria-hidden />
          <span className="truncate">{activeOrgLabel}</span>
          <ChevronDown className="size-4 text-ink-400" aria-hidden />
        </button>
      }
    >
      <MenuLabel>{name}</MenuLabel>
      <MenuSeparator />
      <MenuLabel>{t("switchOrg")}</MenuLabel>
      <MenuItem onSelect={() => switchTo(null)}>
        <User className="size-4" /> <span className="flex-1">{t("personal")}</span> {activeOrgId === null ? <Check className="size-4" /> : null}
      </MenuItem>
      {orgs.map((o) => (
        <MenuItem key={o.id} onSelect={() => switchTo(o.id, o.type)}>
          <Building2 className="size-4" /> <span className="flex-1 truncate">{o.label}</span> {activeOrgId === o.id ? <Check className="size-4" /> : null}
        </MenuItem>
      ))}
      <MenuItem onSelect={() => router.push("/account/organizations")}>
        <span className="ps-6 text-primary-700">{t("organizations")}</span>
      </MenuItem>
      <MenuSeparator />
      <MenuItem onSelect={() => router.push("/account")}>
        <User className="size-4" /> {t("account")}
      </MenuItem>
      {isAdmin ? (
        <MenuItem onSelect={() => router.push("/admin")}>
          <Shield className="size-4" /> {t("admin")}
        </MenuItem>
      ) : null}
      <MenuItem
        onSelect={async () => {
          await authClient.signOut();
          router.push("/login");
          router.refresh();
        }}
      >
        <LogOut className="size-4" /> {t("logout")}
      </MenuItem>
    </Menu>
  );
}
