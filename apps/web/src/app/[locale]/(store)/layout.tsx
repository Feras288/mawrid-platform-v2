import { setRequestLocale } from "next-intl/server";
import { StoreShell } from "@/components/store/store-shell";
import { getCtx } from "@/lib/ctx";

export default async function StoreLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  const ctx = await getCtx();
  return <StoreShell ctx={ctx}>{children}</StoreShell>;
}
