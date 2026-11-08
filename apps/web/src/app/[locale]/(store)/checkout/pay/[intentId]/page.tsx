import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { withSystem } from "@platform/db";
import { orders, paymentIntents } from "@platform/db/schema";
import { TestPayButtons } from "@/components/store/store-client";
import { Alert, Card, CardBody } from "@/components/ui/primitives";
import { requireUserCtx } from "@/lib/ctx";

/** Hosted-page simulator for the TEST payment provider. Not available in production. */
export default async function TestPayPage({ params }: { params: Promise<{ intentId: string }> }) {
  if (process.env.APP_ENV === "production") notFound();
  const { intentId } = await params;
  if (!isUuid(intentId)) notFound();
  const ctx = await requireUserCtx();
  const t = await getTranslations("store");
  const f = await getFormatter();
  const [row] = await withSystem((tx) => tx.select({ i: paymentIntents, code: orders.code }).from(paymentIntents).innerJoin(orders, eq(orders.id, paymentIntents.orderId)).where(eq(paymentIntents.id, intentId)).limit(1));
  if (!row || row.i.userId !== ctx.userId || row.i.provider !== "test") notFound();
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-bold">{t("testPay.title")}</h1>
      <Alert tone="warning">{t("testPay.note")}</Alert>
      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm" dir="ltr">
            {row.code}
          </p>
          <p className="text-2xl font-bold" dir="ltr">
            {f.number(Number(row.i.amount), { style: "currency", currency: row.i.currency })}
          </p>
          {row.i.status === "pending" ? <TestPayButtons intentId={intentId} /> : <p className="text-sm text-ink-600">{row.i.status}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
