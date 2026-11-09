import { ArrowLeft, Store } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { brandName } from "@platform/core";
import type { Ctx } from "@platform/modules/context";
import { listUserOrganizations } from "@platform/modules/context";
import { unreadCount } from "@platform/modules/notifications";
import { BrandMark } from "@/components/brand/brand-mark";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileNav, NavGroups, type NavGroup } from "./nav-client";
import { UserMenu } from "./user-menu";

export interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
  /** message key of the sidebar group this item belongs to */
  group?: string;
  show?: boolean;
}

export async function Brand({ className, tone = "default" }: { className?: string; tone?: "default" | "inverse" }) {
  const locale = await getLocale();
  const name = brandName(locale === "ar" ? "ar" : "en");
  return (
    <Link href="/" className={cn("inline-flex shrink-0 items-center gap-2.5 rounded-lg", tone === "inverse" ? "text-white" : "text-primary-900", className)}>
      <BrandMark tone={tone} />
      <span className="brand-name text-xl leading-none font-extrabold tracking-tight">{name}</span>
    </Link>
  );
}

/**
 * Authenticated portal layout (sidebar + top bar). Used by account, org, supplier and admin portals.
 */
export async function PortalShell({ ctx, portalLabel, nav, children }: { ctx: Ctx; portalLabel: string; nav: NavItem[]; children: React.ReactNode }) {
  const t = await getTranslations();
  const visible = nav.filter((n) => n.show !== false);
  // groups keep the order of their first item; items keep their declared order inside a group
  const groups: NavGroup[] = [];
  for (const n of visible) {
    const label = n.group ? t(n.group) : null;
    let g = groups.find((x) => x.label === label);
    if (!g) groups.push((g = { label, items: [] }));
    g.items.push({ href: n.href, label: t(n.labelKey), icon: n.icon });
  }
  const orgs = ctx.userId ? await listUserOrganizations(ctx.userId) : [];
  const unread = await unreadCount(ctx);
  const activeOrg = orgs.find((o) => o.orgId === ctx.orgId);
  const activeOrgLabel = activeOrg ? (ctx.locale === "ar" ? activeOrg.nameAr : activeOrg.nameEn) : t("nav.personal");
  const storeLink = (
    <div className="shrink-0 border-t border-white/10 p-3">
      <Link href="/" className="flex items-center gap-2 rounded-lg px-3 py-2 text-[0.8125rem] font-medium text-primary-100/85 hover:bg-white/[0.06] hover:text-white">
        <Store className="size-4 text-primary-300" aria-hidden />
        <span className="flex-1">{t("ux.portal.backToStore")}</span>
        <ArrowLeft className="size-3.5 text-primary-300 ltr:rotate-180" aria-hidden />
      </Link>
    </div>
  );
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[17rem] shrink-0 flex-col bg-primary-950 lg:flex">
        <div className="pattern-lattice pointer-events-none absolute inset-0 opacity-60" aria-hidden />
        <div className="relative flex h-16 shrink-0 items-center border-b border-white/10 px-5">
          <Brand tone="inverse" />
        </div>
        <div className="relative px-5 pt-4 pb-1">
          <p className="text-[11px] font-semibold text-primary-300">{portalLabel}</p>
          <p className="mt-0.5 truncate text-sm font-bold text-white">{activeOrgLabel}</p>
        </div>
        <div className="scrollbar-none relative flex-1 overflow-y-auto px-3 py-3">
          <NavGroups label={portalLabel} groups={groups} />
        </div>
        <div className="relative">{storeLink}</div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 min-w-0 items-center gap-2 border-b border-sand-200 bg-white/90 px-3 backdrop-blur sm:gap-3 sm:px-6">
          <MobileNav title={portalLabel} groups={groups} brand={<Brand tone="inverse" />} footer={storeLink} />
          <div className="min-w-0 lg:hidden max-sm:[&_.brand-name]:sr-only">
            <Brand />
          </div>
          <div className="hidden min-w-0 items-center gap-2 lg:flex">
            <span className="rounded-md bg-primary-50 px-2 py-1 text-xs font-bold text-primary-800 ring-1 ring-inset ring-primary-100">{portalLabel}</span>
            <span className="truncate text-sm font-medium text-ink-600">{activeOrgLabel}</span>
          </div>
          <div className="ms-auto flex min-w-0 items-center gap-1 sm:gap-2">
            <LocaleSwitcher />
            <Link href="/account/notifications" className="relative rounded-lg px-2 py-2 text-sm text-ink-600 hover:bg-sand-100" aria-label={`${t("nav.notifications")}${unread ? ` (${unread})` : ""}`}>
              <BellIcon />
              {unread > 0 ? <span className="absolute -top-0.5 end-0 min-w-4 rounded-full bg-danger-600 px-1 text-center text-[10px] font-bold text-white ring-2 ring-white">{unread > 99 ? "99+" : unread}</span> : null}
            </Link>
            <UserMenu
              name={ctx.email ?? ""}
              activeOrgId={ctx.orgId}
              activeOrgLabel={activeOrgLabel}
              orgs={orgs.map((o) => ({ id: o.orgId, label: ctx.locale === "ar" ? o.nameAr : o.nameEn, type: o.type }))}
              isAdmin={ctx.isPlatformAdmin}
            />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[84rem] flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          {ctx.breakglass ? (
            <div role="alert" className="mb-4 rounded-xl border border-warning-600/40 bg-warning-50 px-4 py-2.5 text-sm font-medium text-warning-600">
              Break-glass read-only access — every view is audited.
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
