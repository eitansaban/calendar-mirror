import { calendar_v3 } from "googleapis";
import { config } from "./config";
import { getCalendar, GEvent } from "./google";
import { getState, patchState } from "./supabase";

type Cal = calendar_v3.Calendar;

// ── Event helpers ────────────────────────────────────────────────────────────

function start(ev: GEvent): Date | null {
  const dt = ev.start?.dateTime;
  return dt ? new Date(dt) : null; // null = all-day (start.date only)
}
function end(ev: GEvent): Date | null {
  const dt = ev.end?.dateTime;
  return dt ? new Date(dt) : null;
}
function durationMin(s: Date, e: Date): number {
  return (e.getTime() - s.getTime()) / 60000;
}
function isWeekday(d: Date): boolean {
  // Evaluate the weekday in the configured timezone, not the server's UTC.
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: config.timezone,
    weekday: "short",
  }).format(d);
  return !["Sat", "Sun"].includes(wd);
}

function isMirrorBlock(ev: GEvent): boolean {
  // Own the block if it carries our marker OR simply bears the mirror title.
  // The title check also claims blocks left by the legacy poller, so we never
  // create a mirror-of-a-mirror during cutover.
  if (ev.extendedProperties?.private?.[config.mirrorMarkerKey]) return true;
  return (ev.summary ?? "").trim() === config.mirrorTitle;
}

function qualifies(ev: GEvent, now: Date): boolean {
  if (ev.status === "cancelled") return false;
  if (isMirrorBlock(ev)) return false;
  const s = start(ev);
  const e = end(ev);
  if (!s || !e) return false; // all-day
  if (e <= now) return false; // already over
  if (config.weekdaysOnly && !isWeekday(s)) return false;

  const title = (ev.summary ?? "").toLowerCase();
  for (const kw of config.skipKeywords) if (title.includes(kw)) return false;

  const org = (ev.organizer?.email ?? "").toLowerCase();
  for (const id of config.skipCalendarIds) if (org.includes(id)) return false;

  if (durationMin(s, e) < config.minDurationMin) return false;
  return true;
}

// ── Mirror block CRUD (keyed by extendedProperties.private.mirrorSourceId) ─────

async function findMirror(cal: Cal, sourceId: string): Promise<GEvent | null> {
  const resp = await cal.events.list({
    calendarId: config.sourceCalendarId,
    privateExtendedProperty: [`${config.mirrorMarkerKey}=${sourceId}`],
    showDeleted: false,
    singleEvents: true,
    maxResults: 5,
  });
  const items = (resp.data.items ?? []).filter((e) => e.status !== "cancelled");
  return items[0] ?? null;
}

function mirrorBody(ev: GEvent, s: Date, e: Date): calendar_v3.Schema$Event {
  const mStart = new Date(s.getTime() - config.bufferMinutes * 60000);
  const mEnd = new Date(e.getTime() + config.bufferMinutes * 60000);
  return {
    summary: config.mirrorTitle,
    description: config.mirrorDesc,
    start: { dateTime: mStart.toISOString(), timeZone: config.timezone },
    end: { dateTime: mEnd.toISOString(), timeZone: config.timezone },
    attendees: [{ email: config.inviteEmail() }],
    visibility: "private",
    extendedProperties: { private: { [config.mirrorMarkerKey]: ev.id! } },
  };
}

async function reconcile(cal: Cal, ev: GEvent, now: Date): Promise<string> {
  if (isMirrorBlock(ev)) return "skip-own"; // never mirror our own output
  const sourceId = ev.id;
  if (!sourceId) return "skip-noid";

  const existing = await findMirror(cal, sourceId);

  if (!qualifies(ev, now)) {
    if (existing?.id) {
      await cal.events.delete({
        calendarId: config.sourceCalendarId,
        eventId: existing.id,
        sendUpdates: "all",
      });
      return "deleted";
    }
    return "noop";
  }

  const s = start(ev)!;
  const e = end(ev)!;
  const body = mirrorBody(ev, s, e);

  if (!existing) {
    await cal.events.insert({
      calendarId: config.sourceCalendarId,
      requestBody: body,
      sendUpdates: "all",
    });
    return "created";
  }

  // Update only if the timing actually drifted. Compare instants, not strings:
  // Google echoes times with a tz offset (-07:00) while we emit UTC (Z) — same
  // moment, different text — so string compares would re-patch (and notify) endlessly.
  const sameInstant = (a?: string | null, b?: string | null) =>
    a != null && b != null && new Date(a).getTime() === new Date(b).getTime();
  const drift =
    !sameInstant(existing.start?.dateTime, body.start!.dateTime) ||
    !sameInstant(existing.end?.dateTime, body.end!.dateTime);
  if (drift) {
    await cal.events.patch({
      calendarId: config.sourceCalendarId,
      eventId: existing.id!,
      requestBody: { start: body.start, end: body.end },
      sendUpdates: "all",
    });
    return "updated";
  }
  return "unchanged";
}

// ── Sync drivers ──────────────────────────────────────────────────────────────

function windowBounds(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(timeMin.getTime() + config.lookaheadDays * 86400000);
  return { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() };
}

/** Full sweep of the current window: reconcile every event, then store a fresh syncToken. */
export async function fullSync(): Promise<Record<string, number>> {
  const cal = getCalendar();
  const now = new Date();
  const { timeMin, timeMax } = windowBounds();
  const tally: Record<string, number> = {};

  let pageToken: string | undefined;
  let syncToken: string | undefined;
  do {
    const resp = await cal.events.list({
      calendarId: config.sourceCalendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      // NOTE: no orderBy — Google omits nextSyncToken when orderBy is set, which
      // would break incremental sync. reconcile() doesn't need ordering.
      maxResults: 250,
      pageToken,
    });
    for (const ev of resp.data.items ?? []) {
      const outcome = await reconcile(cal, ev, now);
      tally[outcome] = (tally[outcome] ?? 0) + 1;
    }
    pageToken = resp.data.nextPageToken ?? undefined;
    syncToken = resp.data.nextSyncToken ?? syncToken;
  } while (pageToken);

  await patchState({ sync_token: syncToken ?? null, last_event_at: now.toISOString() });
  return tally;
}

/** Apply only what changed since the stored syncToken. Falls back to fullSync on 410. */
export async function incrementalSync(): Promise<Record<string, number>> {
  const state = await getState();
  if (!state.sync_token) return fullSync();

  const cal = getCalendar();
  const now = new Date();
  const tally: Record<string, number> = {};
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  try {
    do {
      const resp = await cal.events.list({
        calendarId: config.sourceCalendarId,
        syncToken: state.sync_token,
        singleEvents: true,
        maxResults: 250,
        pageToken,
      });
      for (const ev of resp.data.items ?? []) {
        const outcome = await reconcile(cal, ev, now);
        tally[outcome] = (tally[outcome] ?? 0) + 1;
      }
      pageToken = resp.data.nextPageToken ?? undefined;
      nextSyncToken = resp.data.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
  } catch (err: unknown) {
    // 410 GONE = syncToken expired; re-seed from a full sweep.
    const code = (err as { code?: number })?.code;
    if (code === 410) return fullSync();
    throw err;
  }

  await patchState({ sync_token: nextSyncToken ?? state.sync_token, last_event_at: now.toISOString() });
  return tally;
}
