import { isAppError, isUuid } from "@platform/core";
import { getDownloadUrl } from "@platform/modules/files";
import { getCtx } from "@/lib/ctx";

export const dynamic = "force-dynamic";

/** Authorized download: RLS + module checks, then redirect to a 5-minute presigned URL. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const ctx = await getCtx();
  if (!ctx.userId) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const inline = new URL(req.url).searchParams.get("inline") === "1";
    const { url } = await getDownloadUrl(ctx, id, { inline });
    return Response.redirect(url, 302);
  } catch (e) {
    const status = isAppError(e) ? e.status : 500;
    return Response.json({ error: isAppError(e) ? e.messageKey : "internal" }, { status: status === 403 ? 404 : status });
  }
}
