import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * Shared UI primitives. Visual rules live in docs/DESIGN_SYSTEM.md; tokens in app/globals.css.
 * Keep props stable: pages across all portals depend on these signatures.
 */

// ---------------------------------------------------------------------------------- Button
export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-[background-color,border-color,box-shadow,color] duration-150 focus-visible:outline-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(7_49_42/0.3)] hover:bg-primary-800",
        secondary: "bg-primary-50 text-primary-800 ring-1 ring-inset ring-primary-100 hover:bg-primary-100",
        outline: "border border-sand-300 bg-white text-ink-800 shadow-xs hover:border-sand-400 hover:bg-sand-50",
        ghost: "text-ink-700 hover:bg-sand-100",
        danger: "bg-danger-600 text-white hover:bg-danger-700",
        link: "px-0 text-primary-700 underline-offset-4 hover:underline",
        accent: "bg-accent-500 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_2px_rgb(111_74_11/0.35)] hover:bg-accent-600",
      },
      size: { sm: "h-8 rounded-md px-3 text-xs", md: "h-10 px-4", lg: "h-12 rounded-xl px-6 text-base", icon: "size-10" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} type={asChild ? undefined : (type ?? "button")} {...props} />;
}

// ---------------------------------------------------------------------------------- Inputs
const inputBase =
  "w-full rounded-lg border border-sand-300 bg-white px-3 text-sm text-ink-900 shadow-xs transition-[border-color,box-shadow] placeholder:text-ink-400 hover:border-sand-400 focus-visible:border-primary-600 focus-visible:ring-4 focus-visible:ring-primary-600/15 disabled:bg-sand-100 aria-[invalid=true]:border-danger-600 aria-[invalid=true]:ring-danger-600/15";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputBase, "min-h-24 py-2 leading-6", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputBase, "h-10 pe-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[0.8125rem] font-semibold text-ink-700", className)} {...props} />;
}

export function Checkbox({ className, label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm text-ink-700", className)}>
      <input type="checkbox" className="size-4 rounded border-sand-300 accent-primary-700" {...props} />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------------- Layout bits
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-[var(--radius-card)] border border-sand-200/80 bg-white shadow-card", className)} {...props} />;
}
export function CardHeader({ className, title, description, actions }: { className?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-sand-100 px-5 py-4 sm:px-6", className)}>
      <div className="min-w-0">
        <h2 className="text-h3 font-bold text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4 sm:px-6 sm:py-5", className)} {...props} />;
}

export function PageHeader({ title, description, actions, breadcrumbs }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; breadcrumbs?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-sand-200/70 pb-5 sm:mb-8">
      <div className="min-w-0">
        {breadcrumbs ? <div className="mb-2 text-xs font-medium text-ink-500">{breadcrumbs}</div> : null}
        <h1 className="text-h1 font-bold tracking-tight text-ink-900">{title}</h1>
        {description ? <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Section title used between groups of cards on dashboards and store pages. */
export function SectionHeading({ title, description, action, className, id }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-h2 font-bold tracking-tight text-ink-900">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", {
  variants: {
    tone: {
      neutral: "bg-sand-100 text-ink-600 ring-sand-200",
      success: "bg-success-50 text-success-600 ring-success-600/15",
      warning: "bg-warning-50 text-warning-600 ring-warning-600/15",
      danger: "bg-danger-50 text-danger-600 ring-danger-600/15",
      info: "bg-info-50 text-info-600 ring-info-600/15",
      primary: "bg-primary-50 text-primary-700 ring-primary-700/10",
      accent: "bg-accent-100 text-accent-700 ring-accent-500/15",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const tones = {
    info: "border-info-600/25 bg-info-50 text-info-600",
    warning: "border-warning-600/25 bg-warning-50 text-warning-600",
    danger: "border-danger-600/25 bg-danger-50 text-danger-700",
    success: "border-success-600/25 bg-success-50 text-success-600",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm leading-6", tones[tone], className)}>
      {title ? <p className="font-bold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : undefined}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? <div className="mb-2 grid size-14 place-items-center rounded-2xl bg-primary-50 text-primary-700 ring-8 ring-primary-50/50 [&_svg]:size-7">{icon}</div> : null}
      <p className="text-h3 font-bold text-ink-800">{title}</p>
      {description ? <p className="max-w-md text-sm leading-6 text-ink-500">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-2 text-sm text-ink-500", className)}>
      <span className="size-4 animate-spin rounded-full border-2 border-sand-300 border-t-primary-700" aria-hidden />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-sand-200", className)} aria-hidden />;
}

/** KPI tile: label, prominent value, optional icon and hint. */
export function Stat({ label, value, hint, tone, icon }: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "primary"; icon?: React.ReactNode }) {
  return (
    <Card className={cn("relative overflow-hidden p-4 sm:p-5", tone === "primary" && "border-primary-200 bg-gradient-to-br from-primary-50 to-white")}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] font-semibold text-ink-500">{label}</p>
        {icon ? (
          <span className="hidden size-9 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-100 min-[400px]:grid [&_svg]:size-[1.125rem]" aria-hidden>
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[1.3125rem] leading-tight font-bold tracking-tight break-words text-ink-900 tabular-nums sm:text-[1.75rem]">{value}</p>
      {hint ? <p className="mt-1.5 text-xs leading-5 text-ink-500">{hint}</p> : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------------- Table
export function Table({ className, children, caption }: { className?: string; children: React.ReactNode; caption?: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={cn("border-b border-sand-200 bg-sand-100/70 px-4 py-3 text-start text-xs font-bold whitespace-nowrap text-ink-600", className)} {...props} />;
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-sand-100 px-4 py-3 align-middle text-ink-700", className)} {...props} />;
}
export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("transition-colors hover:bg-primary-50/40", className)} {...props} />;
}

export function Dl({ items, className }: { items: { label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-ink-500">{it.label}</dt>
          <dd className="mt-0.5 text-sm font-medium break-words text-ink-900">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
