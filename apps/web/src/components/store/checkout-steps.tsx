import { Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

/** Purchase progress indicator (review → delivery & payment → confirmation). Informational only. */
export async function CheckoutSteps({ current }: { current: 1 | 2 | 3 }) {
  const t = await getTranslations("ux.steps");
  const steps = [t("review"), t("delivery"), t("confirm")];
  return (
    <ol aria-label={t("label")} className="flex items-center gap-2 text-xs font-semibold sm:gap-3 sm:text-sm">
      {steps.map((s, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={s} className="flex min-w-0 items-center gap-2 sm:gap-3" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold",
                done && "bg-primary-700 text-white",
                active && "bg-accent-500 text-white ring-4 ring-accent-100",
                !done && !active && "bg-sand-200 text-ink-600",
              )}
            >
              {done ? <Check className="size-4" aria-hidden /> : n}
            </span>
            <span className={cn("truncate", active ? "text-ink-900" : "text-ink-500", !active && "hidden sm:inline")}>{s}</span>
            {n < steps.length ? <span className="h-px w-6 bg-sand-300 sm:w-12" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
