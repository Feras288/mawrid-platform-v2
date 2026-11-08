import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { withContext } from "@platform/db";
import { invoices, orderLines } from "@platform/db/schema";
import { qrDataUrl } from "@platform/integrations/pdf";
import { dbCtx } from "@platform/modules/context";
import { PrintButton } from "@/components/store/print-button";
import { Card } from "@/components/ui/primitives";
import { requireUserCtx } from "@/lib/ctx";

/** Printable tax invoice / credit note. Visible to the customer and the issuing supplier only (RLS). */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireUserCtx();
  const t = await getTranslations("invoice");
  const f = await getFormatter();
  const data = await withContext(dbCtx(ctx), async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!inv) return null;
    const lines = await tx.select().from(orderLines).where(eq(orderLines.groupId, inv.groupId));
    const [orig] = inv.originalInvoiceId ? await tx.select({ number: invoices.number }).from(invoices).where(eq(invoices.id, inv.originalInvoiceId)).limit(1) : [];
    return { inv, lines, orig: orig ?? null };
  });
  if (!data) notFound();
  const { inv, lines } = data;
  const money = (v: string) => f.number(Number(v), { style: "currency", currency: "SAR" });
  const qr = await qrDataUrl(inv.qrTlv);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton label={t("print")} />
      </div>
      <Card className="space-y-6 p-6 print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{t(`kinds.${inv.kind as "simplified"}`)}</h1>
            <p className="font-mono text-sm" dir="ltr">
              {inv.number}
            </p>
            {data.orig ? (
              <p className="text-xs text-ink-500">
                {t("original")}: <span dir="ltr">{data.orig.number}</span>
              </p>
            ) : null}
          </div>
          <img src={qr} alt="ZATCA QR" className="size-32" />
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-500">{t("seller")}</dt>
            <dd className="font-medium">{inv.sellerName}</dd>
          </div>
          <div>
            <dt className="text-ink-500">{t("sellerVat")}</dt>
            <dd dir="ltr">{inv.sellerVatNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-500">{t("buyer")}</dt>
            <dd>{inv.buyerName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-500">{t("buyerVat")}</dt>
            <dd dir="ltr">{inv.buyerVatNumber ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-500">{t("issued")}</dt>
            <dd>{f.dateTime(inv.issuedAt, { dateStyle: "medium", timeStyle: "short" })}</dd>
          </div>
        </dl>
        {inv.kind !== "credit_note" ? (
          <table className="w-full text-sm">
            <thead className="border-b border-sand-200 text-xs text-ink-500">
              <tr>
                <th className="py-2 text-start">SKU</th>
                <th className="py-2 text-start">—</th>
                <th className="py-2 text-end">#</th>
                <th className="py-2 text-end">{t("net")}</th>
                <th className="py-2 text-end">{t("vat")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-b border-sand-100">
                  <td className="py-2 font-mono text-xs" dir="ltr">
                    {l.sku}
                  </td>
                  <td className="py-2">{ctx.locale === "ar" ? l.nameAr : l.nameEn}</td>
                  <td className="py-2 text-end" dir="ltr">
                    {Number(l.quantity)}
                  </td>
                  <td className="py-2 text-end" dir="ltr">
                    {money(l.lineNet)}
                  </td>
                  <td className="py-2 text-end" dir="ltr">
                    {money(l.lineVat)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <dl className="ms-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>{t("net")}</dt>
            <dd dir="ltr">{money(inv.netTotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>{t("vat")}</dt>
            <dd dir="ltr">{money(inv.vatTotal)}</dd>
          </div>
          <div className="flex justify-between border-t border-sand-200 pt-1 font-bold">
            <dt>{t("total")}</dt>
            <dd dir="ltr">{money(inv.total)}</dd>
          </div>
        </dl>
        <p className="text-xs text-ink-500">{t("zatcaNote")}</p>
      </Card>
    </div>
  );
}
