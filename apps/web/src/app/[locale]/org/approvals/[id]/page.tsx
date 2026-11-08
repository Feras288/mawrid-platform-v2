import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { getRequest } from "@platform/modules/approvals";
import { DecisionForm } from "@/components/procurement/approval-client";
import { toneFor } from "@/components/procurement/status";
import { Badge, Button, Card, CardBody, CardHeader, Dl, PageHeader } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireOrgCtx } from "@/lib/ctx";

export default async function ApprovalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireOrgCtx("buyer");
  const t = await getTranslations();
  const f = await getFormatter();
  const { request: r, steps, decisions, canDecide, subjectRef } = await getRequest(ctx, id).catch(() => notFound());
  const href = subjectRef ? (r.subjectType === "purchase_order" ? `/org/purchase-orders/${subjectRef}` : r.subjectType === "award" ? `/org/rfqs/${subjectRef}/compare` : `/org/rfqs/${subjectRef}`) : null;
  return (
    <>
      <PageHeader
        title={r.subjectLabel ?? t(`approvals.ops.${r.operation as "award"}`)}
        breadcrumbs={
          <Link href="/org/approvals" className="hover:underline">
            {t("approvals.title")}
          </Link>
        }
        actions={
          <>
            <Badge tone={toneFor(r.status)}>{t(`approvals.status.${r.status as "pending"}`)}</Badge>
            {href ? (
              <Button asChild variant="outline">
                <Link href={href}>{t("approvals.open")}</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title={t("common.details")} />
          <CardBody>
            <Dl
              items={[
                { label: t("approvals.operation"), value: t(`approvals.ops.${r.operation as "award"}`) },
                { label: t("approvals.amount"), value: r.amount ? f.number(Number(r.amount), { style: "currency", currency: r.currency }) : "—" },
                { label: t("common.createdAt"), value: f.dateTime(r.createdAt, "short") },
                ...(r.decidedAt ? [{ label: t("common.updatedAt"), value: f.dateTime(r.decidedAt, "short") }] : []),
              ]}
            />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={t("approvals.steps")} />
          <CardBody>
            <ol className="space-y-3">
              {steps.map((s) => (
                <li key={s.id} className="rounded-lg border border-sand-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-ink-500" dir="ltr">
                      #{s.stepOrder}
                    </span>
                    <span className="font-medium">{s.name}</span>
                    <Badge tone={toneFor(s.status === "active" ? "pending" : s.status)}>{t(`approvals.stepStatus.${s.status as "waiting"}`)}</Badge>
                    <span className="text-xs text-ink-500">
                      {s.requiredRoleKey ?? t("policies.anyRole")} · {s.minApprovals}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    {decisions
                      .filter((d) => d.stepId === s.id)
                      .map((d) => (
                        <li key={d.id}>
                          <Badge tone={d.decision === "approve" ? "success" : "danger"}>{t(`approvals.${d.decision as "approve"}`)}</Badge> {d.name} · <span className="text-ink-500">{f.dateTime(d.createdAt, "short")}</span>
                          {d.comment ? <p className="ms-2 text-ink-600">{d.comment}</p> : null}
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
      {canDecide ? (
        <Card className="mt-6 max-w-xl">
          <CardHeader title={t("approvals.decisions")} />
          <CardBody>
            <DecisionForm requestId={id} />
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
