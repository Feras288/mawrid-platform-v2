import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants, EmptyState } from "@/components/ui/primitives";

export default async function NotFound() {
  const t = await getTranslations("errors");
  const c = await getTranslations("nav");
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-24">
      <EmptyState title={t("notFoundTitle")} description={t("notFoundBody")} action={<Link href="/" className={buttonVariants({ variant: "outline" })}>{c("home")}</Link>} />
    </main>
  );
}
