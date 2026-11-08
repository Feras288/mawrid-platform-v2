export const dynamic = "force-dynamic";

/** Liveness: the process is up. */
export function GET() {
  return Response.json({ ok: true, service: "web", time: new Date().toISOString() });
}
