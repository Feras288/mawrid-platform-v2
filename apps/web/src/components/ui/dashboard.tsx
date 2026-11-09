import { ArrowLeft, Check } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Dashboard building blocks shared by the buyer, supplier and admin portals. */

export function QuickActions({ items }: { items: { href: string; label: string; icon: React.ReactNode; primary?: boolean }[] }) {
  if (!items.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((a) => (
        <li key={a.href}>
          <Link
            href={a.href}
            className={cn(
              "group flex h-full items-center gap-3 rounded-2xl border p-4 text-sm font-semibold shadow-xs transition-[box-shadow,border-color,background-color]",
              a.primary ? "border-primary-700 bg-primary-700 text-white hover:bg-primary-800" : "border-sand-200/80 bg-white text-ink-800 hover:border-primary-200 hover:shadow-card",
            )}
          >
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-[1.125rem]", a.primary ? "bg-white/15 text-white" : "bg-primary-50 text-primary-700")} aria-hidden>
              {a.icon}
            </span>
            <span className="min-w-0 flex-1 leading-5">{a.label}</span>
            <ArrowLeft className={cn("size-4 shrink-0 opacity-60 transition-transform ltr:rotate-180", "group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5")} aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Compact activity list: title link, meta line and a trailing badge/value. */
export function ActivityList({ items, empty }: { items: { id: string; href: string; title: React.ReactNode; meta?: React.ReactNode; trailing?: React.ReactNode }[]; empty: React.ReactNode }) {
  if (!items.length) return <p className="px-5 py-8 text-center text-sm text-ink-500 sm:px-6">{empty}</p>;
  return (
    <ul className="divide-y divide-sand-100">
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-primary-50/40 sm:px-6">
          <div className="min-w-0 flex-1">
            <Link href={it.href} className="block truncate text-sm font-semibold text-ink-900 hover:text-primary-800 hover:underline">
              {it.title}
            </Link>
            {it.meta ? <p className="mt-0.5 truncate text-xs text-ink-500">{it.meta}</p> : null}
          </div>
          {it.trailing ? <div className="flex shrink-0 items-center gap-2 text-sm">{it.trailing}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** Ordered checklist with done / pending state (onboarding). */
export function Checklist({ items, doneLabel, pendingLabel }: { items: { label: string; done: boolean; href?: string }[]; doneLabel: string; pendingLabel: string }) {
  const done = items.filter((i) => i.done).length;
  return (
    <div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-sand-200" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
        <div className="h-full rounded-full bg-primary-600 transition-[width]" style={{ width: `${(done / Math.max(1, items.length)) * 100}%` }} />
      </div>
      <ol className="space-y-2">
        {items.map((it, i) => {
          const label = it.href && !it.done ? (
            <Link href={it.href} className="font-semibold text-ink-900 hover:text-primary-800 hover:underline">
              {it.label}
            </Link>
          ) : (
            <span className={cn("font-medium", it.done ? "text-ink-500" : "text-ink-900")}>{it.label}</span>
          );
          return (
            <li key={it.label} className="flex items-center gap-3 text-sm">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold", it.done ? "bg-primary-700 text-white" : "bg-sand-100 text-ink-600 ring-1 ring-inset ring-sand-300")}>
                {it.done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className="min-w-0 flex-1">{label}</span>
              <span className="sr-only">{it.done ? doneLabel : pendingLabel}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
