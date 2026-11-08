import { RolesPage } from "@/components/team/team-pages";
import { requireOrgCtx } from "@/lib/ctx";

export default async function Page() {
  return <RolesPage ctx={await requireOrgCtx("buyer")} />;
}
