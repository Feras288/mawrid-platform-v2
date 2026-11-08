import { getTranslations } from "next-intl/server";
import { listSuppliersForAdmin } from "@platform/modules/suppliers";
import { buttonVariants, PageHeader, Stat } from "@/components/ui/primitives";
import { Link } from "@/i18n/navigation";
import { requireAdminCtx } from "@/lib/ctx";

export default async function AdminHome() {
  const ctx = await requireAdminCtx();
  const t = await getTranslations();
  const [pending, review, approved] = await Promise.all([
    listSuppliersForAdmin(ctx, { status: "pending_verification" }),
    listSuppliersForAdmin(ctx, { status: "under_review" }),
    listSuppliersForAdmin(ctx, { status: "approved" }),
  ]);
  return (
    <>
      <PageHeader title={t("admin.title")} actions={<Link href="/admin/suppliers?status=pending_verification" className={buttonVariants()}>{t("admin.review")}</Link>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t("supplier.status.pending_verification")} value={pending.total} tone="primary" />
        <Stat label={t("supplier.status.under_review")} value={review.total} />
        <Stat label={t("supplier.status.approved")} value={approved.total} />
      </div>
    </>
  );
}
