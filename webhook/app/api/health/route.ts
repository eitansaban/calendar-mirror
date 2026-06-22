import { getState } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Lightweight status: is a channel active, when does it expire, last sync time. */
export async function GET(): Promise<Response> {
  try {
    const s = await getState();
    const expMs = s.channel_expiration ? new Date(s.channel_expiration).getTime() : 0;
    return Response.json({
      ok: true,
      channelActive: Boolean(s.channel_id) && expMs > Date.now(),
      channelExpiration: s.channel_expiration,
      hoursUntilExpiry: expMs ? Math.round((expMs - Date.now()) / 3600000) : null,
      hasSyncToken: Boolean(s.sync_token),
      lastEventAt: s.last_event_at,
    });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
