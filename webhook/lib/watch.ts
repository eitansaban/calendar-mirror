import { randomUUID } from "crypto";
import { config } from "./config";
import { getCalendar } from "./google";
import { getState, patchState } from "./supabase";
import { fullSync } from "./mirror";

const WATCH_TTL_SECONDS = 7 * 24 * 3600; // Google caps calendar channels at ~1 week.

/**
 * (Re)register the push channel and re-seed the sync window. Idempotent and safe
 * to call daily: it stops the previous channel, opens a new one, then does a full
 * sweep so the syncToken + backfill stay current.
 */
export async function renewWatch(): Promise<{
  channelId: string;
  expiration: string;
  tally: Record<string, number>;
}> {
  const cal = getCalendar();
  const prev = await getState();

  // Stop the previous channel if we have one (best-effort).
  if (prev.channel_id && prev.resource_id) {
    try {
      await cal.channels.stop({
        requestBody: { id: prev.channel_id, resourceId: prev.resource_id },
      });
    } catch {
      // Channel may already be expired/gone — ignore.
    }
  }

  const channelId = randomUUID();
  const resp = await cal.events.watch({
    calendarId: config.sourceCalendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: config.webhookUrl(),
      token: config.webhookSecret(),
      params: { ttl: String(WATCH_TTL_SECONDS) },
    },
  });

  const expirationMs = resp.data.expiration ? Number(resp.data.expiration) : Date.now() + WATCH_TTL_SECONDS * 1000;
  const expiration = new Date(expirationMs).toISOString();

  await patchState({
    channel_id: channelId,
    resource_id: resp.data.resourceId ?? null,
    channel_expiration: expiration,
    sync_token: null, // force fullSync below to re-seed the window
  });

  const tally = await fullSync();
  console.log(`watch renewed; channel ${channelId}; ${JSON.stringify(tally)}`);
  return { channelId, expiration, tally };
}
