import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/primitives";
import { Brand } from "@/components/shell/portal-shell";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("nav");
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-16">
      <Brand />
      <div className="mt-10 flex gap-3">
        <Link href="/login" className={buttonVariants()}>
          {t("login")}
        </Link>
        <Link href="/register" className={buttonVariants({ variant: "outline" })}>
          {t("register")}
        </Link>
      </div>
    </main>
  );
}
