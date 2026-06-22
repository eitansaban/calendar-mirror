import { config } from "@/lib/config";
import { renewWatch } from "@/lib/watch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily cron: re-register the push channel (they expire ~weekly) and re-seed the
 * sync window. Also reachable manually for first-time setup:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_SUBDOMAIN.example.com/api/cron/renew-watch
 */
export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${config.cronSecret()}`) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    const result = await renewWatch();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("renew-watch error", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
