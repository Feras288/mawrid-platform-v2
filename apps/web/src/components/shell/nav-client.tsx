"use client";

import {
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CheckSquare,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Flag,
  FolderKanban,
  Gauge,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  MapPin,
  Menu,
  Package,
  Receipt,
  ScrollText,
  Settings,
  Shield,
  ShoppingBag,
  Store,
  Tags,
  TrendingUp,
  Truck,
  Upload,
  Users,
  Warehouse,
  X,
  Bot,
  Wallet,
  Undo2,
  Lock,
} from "lucide-react";
import { Dialog as D } from "radix-ui";
import * as React from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  boq: FileSpreadsheet,
  rfq: ClipboardList,
  quotes: Receipt,
  approvals: CheckSquare,
  po: FileText,
  members: Users,
  roles: KeyRound,
  settings: Settings,
  analytics: BarChart3,
  price: TrendingUp,
  products: Package,
  pricing: Tags,
  inventory: Boxes,
  warehouses: Warehouse,
  profile: Building2,
  documents: ScrollText,
  bell: Bell,
  security: Shield,
  addresses: MapPin,
  orgs: Building2,
  store: Store,
  orders: ShoppingBag,
  flags: Flag,
  jobs: Gauge,
  audit: ListChecks,
  shipping: Truck,
  upload: Upload,
  ai: Bot,
  finance: Wallet,
  returns: Undo2,
  privacy: Lock,
};

export type NavGroup = { label: string | null; items: { href: string; label: string; icon: string }[] };

export function NavLink({ href, icon, children, onNavigate }: { href: string; icon: string; children: React.ReactNode; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === href || (href.split("/").length > 2 && pathname.startsWith(`${href}/`));
  const Icon = ICONS[icon] ?? LayoutDashboard;
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[0.8125rem] font-medium text-primary-100/85 transition-colors hover:bg-white/[0.06] hover:text-white",
        active && "bg-white/10 font-semibold text-white hover:bg-white/10",
      )}
    >
      {active ? <span className="absolute inset-y-1.5 start-0 w-1 rounded-full bg-accent-300" aria-hidden /> : null}
      <Icon className={cn("size-[1.0625rem] shrink-0 text-primary-300 group-hover:text-primary-100", active && "text-accent-200 group-hover:text-accent-200")} />
      <span className="truncate">{children}</span>
    </Link>
  );
}

/** Sidebar navigation, grouped by area. Used in the desktop sidebar and the mobile drawer. */
export function NavGroups({ label, groups, onNavigate }: { label: string; groups: NavGroup[]; onNavigate?: () => void }) {
  return (
    <nav aria-label={label} className="flex flex-col gap-5">
      {groups.map((g, i) => (
        <div key={g.label ?? i}>
          {g.label ? <p className="mb-1.5 px-3 text-[11px] font-bold tracking-wide text-primary-300 uppercase">{g.label}</p> : null}
          <div className="flex flex-col gap-0.5">
            {g.items.map((it) => (
              <NavLink key={it.href} href={it.href} icon={it.icon} onNavigate={onNavigate}>
                {it.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function MobileNav({ title, groups, brand, footer }: { title: string; groups: NavGroup[]; brand?: React.ReactNode; footer?: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger className="rounded-lg p-2 text-ink-700 hover:bg-sand-100 lg:hidden" aria-label={title}>
        <Menu className="size-5" />
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink-900/50 backdrop-blur-[2px]" />
        <D.Content className="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-primary-950 shadow-overlay">
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-4">
            {brand}
            <D.Close className="rounded-md p-1.5 text-primary-100 hover:bg-white/10" aria-label="Close">
              <X className="size-5" />
            </D.Close>
          </div>
          <D.Title className="px-6 pt-4 text-xs font-semibold text-primary-200">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          <div className="flex-1 px-3 py-3">
            <NavGroups label={title} groups={groups} onNavigate={() => setOpen(false)} />
          </div>
          {footer}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
