import { getFormatter, getTranslations } from "next-intl/server";
import { jobsOverview } from "@platform/modules/admin";
import { RetryDeliveryButton } from "@/components/admin/console-client";
import { Badge, Card, CardBody, CardHeader, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function JobsPage() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations("adm");
  const f = await getFormatter();
  const d = await jobsOverview(ctx);
  return (
    <>
      <PageHeader title={t("jobs")} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`${t("outbox")} · ${t("pending")}`} value={d.outbox.pending} />
        <Stat label={`${t("outbox")} · ${t("failed")}`} value={d.outbox.failed} />
        {d.deliveries.map((x) => (
          <Stat key={x.status} label={`${t("deliveries")} · ${x.status}`} value={x.n} />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={`${t("queue")} (24h)`} />
          <Table caption={t("queue")}>
            <thead>
              <tr>
                <Th>{t("queue")}</Th>
                <Th>{t("status")}</Th>
                <Th>{t("count")}</Th>
                <Th>{t("avgMs")}</Th>
              </tr>
            </thead>
            <tbody>
              {d.byQueue.map((q) => (
                <Tr key={`${q.queue}-${q.status}`}>
                  <Td dir="ltr">{q.queue}</Td>
                  <Td>
                    <Badge tone={q.status === "failed" ? "danger" : q.status === "completed" ? "success" : "info"}>{q.status}</Badge>
                  </Td>
                  <Td>{q.n}</Td>
                  <Td>{q.avgMs ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title={t("failedDeliveries")} />
          <CardBody>
            {d.failedDeliveries.length === 0 ? (
              <p className="text-sm text-ink-500">{t("noData")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.failedDeliveries.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span dir="ltr">{x.template}</span> · <span dir="ltr">{x.recipient}</span> · {t("attempts")}: {x.attempts}
                      <span className="block text-xs text-danger-600">{x.lastError}</span>
                    </span>
                    <RetryDeliveryButton id={x.id} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title={t("recentJobs")} />
        <Table caption={t("recentJobs")}>
          <thead>
            <tr>
              <Th>{t("job")}</Th>
              <Th>{t("status")}</Th>
              <Th>{t("attempts")}</Th>
              <Th>{t("duration")}</Th>
              <Th>{t("started")}</Th>
              <Th>{t("error")}</Th>
            </tr>
          </thead>
          <tbody>
            {[...d.failed, ...d.recent.filter((r) => r.status !== "failed")].slice(0, 60).map((j) => (
              <Tr key={j.id}>
                <Td dir="ltr" className="text-xs">
                  {j.queue}/{j.jobName}
                </Td>
                <Td>
                  <Badge tone={j.status === "failed" ? "danger" : j.status === "completed" ? "success" : "info"}>{j.status}</Badge>
                </Td>
                <Td>{j.attempt}</Td>
                <Td>{j.durationMs ?? "—"}</Td>
                <Td>{f.dateTime(j.startedAt, "short")}</Td>
                <Td className="max-w-xs truncate text-xs text-danger-600">{j.error}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
