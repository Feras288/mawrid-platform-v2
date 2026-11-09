import { ArrowLeftRight, Building2, ShoppingBag, Store } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { listUserOrganizations } from "@platform/modules/context";
import { getMe } from "@platform/modules/identity";
import { Link } from "@/i18n/navigation";
import { Badge, buttonVariants, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { requireUserCtx } from "@/lib/ctx";

export default async function AccountHome() {
  const ctx = await requireUserCtx();
  const t = await getTranslations();
  const me = await getMe(ctx);
  const orgs = await listUserOrganizations(ctx.userId);
  return (
    <>
      <PageHeader title={t("account.welcome", { name: me?.name ?? "" })} description={me?.email} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <Store className="size-6 text-primary-700" aria-hidden />
          <h2 className="mt-3 font-semibold">{t("account.personalShopping")}</h2>
          <div className="mt-4 flex gap-2">
            <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>{t("nav.store")}</Link>
            <Link href="/account/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}><ShoppingBag />{t("nav.orders")}</Link>
          </div>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader title={t("account.organizations")} actions={<Link href="/account/organizations" className={buttonVariants({ variant: "outline", size: "sm" })}><ArrowLeftRight />{t("common.manage")}</Link>} />
          <CardBody>
            {orgs.length === 0 ? (
              <p className="text-sm text-ink-500">{t("account.noOrgsHint")}</p>
            ) : (
              <ul className="divide-y divide-sand-100">
                {orgs.map((o) => (
                  <li key={o.orgId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <Building2 className="size-4 text-ink-400" aria-hidden />
                      <span className="min-w-0 truncate font-medium">{ctx.locale === "ar" ? o.nameAr : o.nameEn}</span>
                      <Badge tone={o.type === "supplier" ? "accent" : "primary"}>{t(`account.orgType.${o.type as "buyer" | "supplier" | "platform"}`)}</Badge>
                    </span>
                    {o.orgId === ctx.orgId ? <Badge tone="success">{t("account.active")}</Badge> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
