import { getLocale, getTranslations } from "next-intl/server";
import type { Ctx } from "@platform/modules/context";
import { listUserOrganizations } from "@platform/modules/context";
import { unreadCount } from "@platform/modules/notifications";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { LocaleSwitcher } from "./locale-switcher";
import { MobileNav, NavLink } from "./nav-client";
import { UserMenu } from "./user-menu";

export interface NavItem {
  href: string;
  labelKey: string;
  icon: string;
  show?: boolean;
}

export async function Brand({ className }: { className?: string }) {
  const locale = await getLocale();
  const name = locale === "ar" ? (process.env.BRAND_NAME_AR ?? "مَوْرِد") : (process.env.BRAND_NAME_EN ?? "Mawrid");
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2 font-bold text-primary-800", className)}>
      <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-primary-700 text-sm text-white">
        م
      </span>
      <span className="text-lg">{name}</span>
    </Link>
  );
}

/**
 * Authenticated portal layout (sidebar + top bar). Used by account, org, supplier and admin portals.
 */
export async function PortalShell({ ctx, portalLabel, nav, children }: { ctx: Ctx; portalLabel: string; nav: NavItem[]; children: React.ReactNode }) {
  const t = await getTranslations();
  const items = nav.filter((n) => n.show !== false).map((n) => ({ href: n.href, label: t(n.labelKey), icon: n.icon }));
  const orgs = ctx.userId ? await listUserOrganizations(ctx.userId) : [];
  const unread = await unreadCount(ctx);
  const activeOrg = orgs.find((o) => o.orgId === ctx.orgId);
  const sidebar = (
    <nav aria-label={portalLabel} className="flex flex-col gap-0.5">
      {items.map((it) => (
        <NavLink key={it.href} href={it.href} icon={it.icon}>
          {it.label}
        </NavLink>
      ))}
    </nav>
  );
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-e border-sand-200 bg-white lg:flex">
        <div className="flex h-16 items-center border-b border-sand-200 px-5">
          <Brand />
        </div>
        <div className="px-3 py-3">
          <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{portalLabel}</p>
          {sidebar}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-sand-200 bg-white/95 px-4 backdrop-blur">
          <MobileNav title={portalLabel} items={items} />
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ms-auto flex items-center gap-2">
            <LocaleSwitcher />
            <Link href="/account/notifications" className="relative rounded-lg px-2 py-2 text-sm text-ink-600 hover:bg-sand-100" aria-label={`${t("nav.notifications")}${unread ? ` (${unread})` : ""}`}>
              <BellIcon />
              {unread > 0 ? <span className="absolute -top-0.5 end-0 min-w-4 rounded-full bg-danger-600 px-1 text-center text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span> : null}
            </Link>
            <UserMenu
              name={ctx.email ?? ""}
              activeOrgId={ctx.orgId}
              activeOrgLabel={activeOrg ? (ctx.locale === "ar" ? activeOrg.nameAr : activeOrg.nameEn) : t("nav.personal")}
              orgs={orgs.map((o) => ({ id: o.orgId, label: ctx.locale === "ar" ? o.nameAr : o.nameEn, type: o.type }))}
              isAdmin={ctx.isPlatformAdmin}
            />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {ctx.breakglass ? (
            <div role="alert" className="mb-4 rounded-lg border border-warning-600/40 bg-warning-50 px-4 py-2 text-sm text-warning-600">
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
