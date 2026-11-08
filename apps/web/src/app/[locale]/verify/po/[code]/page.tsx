import { CheckCircle2, XCircle } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { verifyPo } from "@platform/modules/purchase-orders";
import { Card } from "@/components/ui/primitives";
import { localized } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function VerifyPoPage({ params }: { params: Promise<{ code: string; locale: string }> }) {
  const { code, locale } = await params;
  const t = await getTranslations();
  const f = await getFormatter();
  const row = await verifyPo(code);
  const ok = row && row.approvalStatus === "approved";
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-16">
      <Card className="p-6 text-center">
        <h1 className="mb-4 text-xl font-bold">{t("po.verifyTitle")}</h1>
        {ok ? <CheckCircle2 className="mx-auto mb-3 size-12 text-success-600" aria-hidden /> : <XCircle className="mx-auto mb-3 size-12 text-danger-600" aria-hidden />}
        <p className="mb-4 font-medium" role="status">
          {!row ? t("po.verifyNotFound") : ok ? t("po.verifyOk") : t("po.verifyNotIssued")}
        </p>
        {row ? (
          <dl className="grid grid-cols-2 gap-2 text-start text-sm">
            <dt className="text-ink-500">{t("po.code")}</dt>
            <dd dir="ltr">{row.code}</dd>
            <dt className="text-ink-500">{t("po.buyer")}</dt>
            <dd>{localized({ nameAr: row.buyerAr, nameEn: row.buyerEn }, locale)}</dd>
            <dt className="text-ink-500">{t("po.supplier")}</dt>
            <dd>{localized({ nameAr: row.supplierAr, nameEn: row.supplierEn }, locale)}</dd>
            {row.issuedAt ? (
              <>
                <dt className="text-ink-500">{t("po.issuedAt")}</dt>
                <dd>{f.dateTime(row.issuedAt, "short")}</dd>
              </>
            ) : null}
            {row.total ? (
              <>
                <dt className="text-ink-500">{t("po.total")}</dt>
                <dd dir="ltr">{f.number(Number(row.total), { style: "currency", currency: row.currency })}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
      </Card>
    </main>
  );
}
