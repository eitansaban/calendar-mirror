import { config } from "@/lib/config";
import { incrementalSync } from "@/lib/mirror";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Google Calendar push endpoint. Google POSTs here on any change to the watched
 * calendar (the body is empty; the signal is in the headers). We verify the
 * shared channel token, then apply an incremental sync.
 *
 * Headers: https://developers.google.com/calendar/api/guides/push
 */
export async function POST(req: Request): Promise<Response> {
  const token = req.headers.get("x-goog-channel-token");
  if (token !== config.webhookSecret()) {
    return new Response("forbidden", { status: 403 });
  }

  const state = req.headers.get("x-goog-resource-state");
  // The first message after watch() is a "sync" handshake — just ack it.
  if (state === "sync") {
    return new Response("ok", { status: 200 });
  }

  try {
    const tally = await incrementalSync();
    console.log("calendar-webhook sync", JSON.stringify(tally));
  } catch (err) {
    console.error("calendar-webhook error", err);
    // 500 tells Google to retry with backoff.
    return new Response("error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
