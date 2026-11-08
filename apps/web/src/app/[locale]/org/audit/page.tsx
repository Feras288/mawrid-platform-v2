import { AuditPage } from "@/components/team/team-pages";
import { requireOrgCtx } from "@/lib/ctx";

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  return <AuditPage ctx={await requireOrgCtx(["buyer", "supplier"])} page={Number(page) || 1} />;
}
