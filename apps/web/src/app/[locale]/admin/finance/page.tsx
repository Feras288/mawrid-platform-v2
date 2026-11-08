import { getFormatter, getTranslations } from "next-intl/server";
import { ledgerSummary, listPendingBankTransfers, listRefundsNeedingAction, listWebhookEvents } from "@platform/modules/payments";
import { ConfirmTransferDialog, ManualRefundDialog } from "@/components/admin/console-client";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Table, Td, Th, Tr } from "@/components/ui/primitives";
import { requireAdminCtx } from "@/lib/ctx";

export default async function FinancePage() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations("adm");
  const f = await getFormatter();
  const [ledger, transfers, refunds, hooks] = await Promise.all([ledgerSummary(ctx), listPendingBankTransfers(ctx), listRefundsNeedingAction(ctx), listWebhookEvents(ctx, 50)]);
  const money = (v: string | null) => (v ? f.number(Number(v), { style: "currency", currency: "SAR" }) : "—");
  return (
    <>
      <PageHeader title={t("finance")} />
      <Alert tone="info" className="mb-4">
        {t("payoutsNote")}
      </Alert>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t("ledger")} actions={<Badge tone={ledger.balanced ? "success" : "danger"}>{ledger.balanced ? t("balanced") : t("unbalanced")}</Badge>} />
          <Table caption={t("ledger")}>
            <thead>
              <tr>
                <Th>{t("account")}</Th>
                <Th>{t("debit")}</Th>
                <Th>{t("credit")}</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.accounts.map((a) => (
                <Tr key={a.account}>
                  <Td dir="ltr" className="font-mono text-xs">
                    {a.account}
                  </Td>
                  <Td dir="ltr">{money(a.debit)}</Td>
                  <Td dir="ltr">{money(a.credit)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title={t("bankTransfers")} />
          <CardBody>
            {transfers.length === 0 ? (
              <p className="text-sm text-ink-500">{t("noData")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {transfers.map(({ intent, code }) => (
                  <li key={intent.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span dir="ltr">
                      {code} · {intent.providerRef} · {money(intent.amount)}
                    </span>
                    <ConfirmTransferDialog intentId={intent.id} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("refundsAction")} />
          <CardBody>
            {refunds.length === 0 ? (
              <p className="text-sm text-ink-500">{t("noData")}</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {refunds.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <bdi dir="ltr">{money(r.amount)}</bdi> · {r.reason} · <Badge tone={r.status === "failed" ? "danger" : "warning"}>{r.status}</Badge>
                      {r.failureReason ? <span className="block text-xs text-ink-500">{r.failureReason}</span> : null}
                    </span>
                    {r.status === "manual_required" ? <ManualRefundDialog refundId={r.id} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={t("webhooks")} />
          <Table caption={t("webhooks")}>
            <thead>
              <tr>
                <Th>{t("time")}</Th>
                <Th>{t("provider")}</Th>
                <Th>{t("signature")}</Th>
                <Th>{t("status")}</Th>
              </tr>
            </thead>
            <tbody>
              {hooks.map((h) => (
                <Tr key={h.id}>
                  <Td className="text-xs">{f.dateTime(h.createdAt, "short")}</Td>
                  <Td dir="ltr" className="text-xs">
                    {h.provider} · {h.eventType ?? ""}
                  </Td>
                  <Td>
                    <Badge tone={h.signatureValid ? "success" : "danger"}>{h.signatureValid ? t("valid") : t("invalid")}</Badge>
                  </Td>
                  <Td dir="ltr" className="text-xs">
                    {h.status} {h.error ? `· ${h.error}` : ""}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
