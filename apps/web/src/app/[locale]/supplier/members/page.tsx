import { MembersPage } from "@/components/team/team-pages";
import { requireOrgCtx } from "@/lib/ctx";

export default async function Page() {
  return <MembersPage ctx={await requireOrgCtx("supplier")} />;
}
