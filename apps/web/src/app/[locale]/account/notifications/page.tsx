import { Bell } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { listMyNotifications } from "@platform/modules/notifications";
import { markAllReadAction } from "@/app/actions/account";
import { ActionButton } from "@/components/ui/form";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireUserCtx } from "@/lib/ctx";
import { cn } from "@/lib/utils";

export default async function NotificationsPage() {
  const ctx = await requireUserCtx();
  const t = await getTranslations("notifications");
  const f = await getFormatter();
  const items = await listMyNotifications(ctx, { limit: 100 });
  return (
    <>
      <PageHeader title={t("title")} actions={items.some((i) => !i.readAt) ? <ActionButton variant="outline" action={markAllReadAction}>{t("markAllRead")}</ActionButton> : null} />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={<Bell />} title={t("empty")} />
        ) : (
          <ul className="divide-y divide-sand-100">
            {items.map((n) => {
              const body = (
                <div className={cn("px-5 py-3", !n.readAt && "bg-primary-50/40")}>
                  <div className="flex items-center justify-between gap-3">
                    <p className={cn("text-sm", !n.readAt ? "font-semibold text-ink-900" : "text-ink-700")}>{n.title}</p>
                    <time className="shrink-0 text-xs text-ink-400" dateTime={n.createdAt.toISOString()}>{f.relativeTime(n.createdAt)}</time>
                  </div>
                  {n.body ? <p className="mt-0.5 text-sm text-ink-500">{n.body}</p> : null}
                  {!n.readAt ? <span className="sr-only">{t("unread")}</span> : null}
                </div>
              );
              return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-sand-50">{body}</Link> : body}</li>;
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
