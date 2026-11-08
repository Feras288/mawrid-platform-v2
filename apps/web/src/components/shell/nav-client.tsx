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
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-sand-100 hover:text-ink-900",
        active && "bg-primary-50 text-primary-800 hover:bg-primary-50",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{children}</span>
    </Link>
  );
}

export function MobileNav({ title, items }: { title: string; items: { href: string; label: string; icon: string }[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger className="rounded-lg p-2 text-ink-700 hover:bg-sand-100 lg:hidden" aria-label={title}>
        <Menu className="size-5" />
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink-900/40" />
        <D.Content className="fixed inset-y-0 start-0 z-50 w-72 overflow-y-auto bg-white p-4 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <D.Title className="text-sm font-semibold text-ink-500">{title}</D.Title>
            <D.Close className="rounded-md p-1 hover:bg-sand-100" aria-label="Close">
              <X className="size-5" />
            </D.Close>
          </div>
          <D.Description className="sr-only">{title}</D.Description>
          <nav className="flex flex-col gap-0.5">
            {items.map((it) => (
              <NavLink key={it.href} href={it.href} icon={it.icon} onNavigate={() => setOpen(false)}>
                {it.label}
              </NavLink>
            ))}
          </nav>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
