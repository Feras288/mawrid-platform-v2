import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isUuid } from "@platform/core";
import { getMyOrder } from "@platform/modules/commerce";
import { syncOrderPayment } from "@platform/modules/payments";
import { buttonVariants, Card, CardBody } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireUserCtx } from "@/lib/ctx";

export const dynamic = "force-dynamic";

export default async function PaymentResult({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order: orderId } = await searchParams;
  if (!orderId || !isUuid(orderId)) notFound();
  const ctx = await requireUserCtx();
  const t = await getTranslations("store.result");
  // a late webhook should not leave the customer guessing: ask the provider directly
  await syncOrderPayment(ctx, orderId).catch(() => null);
  const data = await getMyOrder(ctx, orderId).catch(() => notFound());
  const paid = data.order.paymentStatus === "paid" || data.order.paymentStatus === "partially_refunded";
  const failed = data.order.paymentStatus === "failed" || data.order.status === "expired";
  const Icon = paid ? CheckCircle2 : failed ? XCircle : Clock;
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardBody className="space-y-4 text-center">
          <Icon className={`mx-auto size-12 ${paid ? "text-success-600" : failed ? "text-danger-600" : "text-warning-600"}`} aria-hidden />
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p role="status">{paid ? t("paid") : failed ? t("failed") : t("pending")}</p>
          <p className="font-mono text-sm" dir="ltr">
            {data.order.code}
          </p>
          <Link href={`/account/orders/${orderId}`} className={buttonVariants()}>
            {t("viewOrder")}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
