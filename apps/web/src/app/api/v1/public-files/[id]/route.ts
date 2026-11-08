import { and, eq, isNull } from "drizzle-orm";
import { isUuid } from "@platform/core";
import { withPublic } from "@platform/db";
import { files } from "@platform/db/schema";
import { getStorage } from "@platform/integrations/storage";

export const dynamic = "force-dynamic";

/** Streams files classified `public` (product images, logos) from private storage with caching. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return new Response(null, { status: 404 });
  const [f] = await withPublic((tx) => tx.select().from(files).where(and(eq(files.id, id), eq(files.classification, "public"), isNull(files.deletedAt))).limit(1));
  if (!f) return new Response(null, { status: 404 });
  const body = await getStorage().get(f.storageKey);
  return new Response(new Uint8Array(body), {
    headers: { "content-type": f.mimeType, "cache-control": "public, max-age=86400, immutable", "x-content-type-options": "nosniff", "content-disposition": "inline" },
  });
}
