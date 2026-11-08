import { NextResponse } from "next/server";
import { logger } from "@platform/core/logger";
import { processWebhook } from "@platform/modules/payments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 256 * 1024;

/**
 * Payment provider webhooks. The raw body is verified by the provider adapter (HMAC / secret token),
 * stored once per provider event id, and the payment state is re-fetched from the provider before
 * any order changes. Responds 2xx for processed/duplicate/ignored, 401 for bad signatures, 500 to
 * ask the provider to retry on processing errors.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
  try {
    const r = await processWebhook(provider, raw, req.headers);
    return NextResponse.json({ result: r.result }, { status: r.status });
  } catch (err) {
    logger.error({ err, provider }, "webhook processing error");
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
