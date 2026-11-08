import { getTranslations } from "next-intl/server";
import { Alert, Badge, type BadgeTone, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { SubmitVerificationButton } from "./supplier-forms";

const TONE: Record<string, BadgeTone> = { new: "neutral", pending_verification: "info", under_review: "warning", approved: "success", suspended: "danger", rejected: "danger" };

export async function SupplierStatusCard({ status, reason, canSubmit }: { status: string; reason: string | null; canSubmit: boolean }) {
  const t = await getTranslations("supplier");
  const s = status as "new";
  return (
    <Card>
      <CardHeader title={t("statusTitle")} actions={<Badge tone={TONE[status] ?? "neutral"}>{t(`status.${s}`)}</Badge>} />
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-600">{t(`statusHint.${s}`)}</p>
        {reason && (status === "rejected" || status === "suspended" || status === "new") ? <Alert tone="warning">{reason}</Alert> : null}
        {canSubmit && (status === "new" || status === "rejected") ? <SubmitVerificationButton /> : null}
      </CardBody>
    </Card>
  );
}
