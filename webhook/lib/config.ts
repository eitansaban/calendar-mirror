// Centralized, env-driven config. No personal data is hard-coded.

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

function int(key: string, dflt: number): number {
  const v = process.env[key];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : dflt;
}

function set(key: string, dflt: string): Set<string> {
  return new Set(
    (process.env[key] ?? dflt)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const config = {
  // Google OAuth (calendar scope only)
  clientId: () => req("GOOGLE_CLIENT_ID"),
  clientSecret: () => req("GOOGLE_CLIENT_SECRET"),
  refreshToken: () => req("GOOGLE_REFRESH_TOKEN"),

  // Webhook plumbing
  webhookUrl: () => req("WEBHOOK_URL"),
  webhookSecret: () => req("WEBHOOK_SECRET"),
  cronSecret: () => req("CRON_SECRET"),

  // Supabase
  supabaseUrl: () => req("SUPABASE_URL"),
  supabaseKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),

  // Mirror behavior
  sourceCalendarId: process.env.SOURCE_CALENDAR_ID || "primary",
  inviteEmail: () => req("MIRROR_INVITE_EMAIL"),
  timezone: process.env.TIMEZONE || "America/Los_Angeles",
  mirrorTitle: process.env.MIRROR_TITLE || "Personal — Busy",
  mirrorDesc: process.env.MIRROR_DESC || "Personal commitment. Time protected.",
  lookaheadDays: int("LOOKAHEAD_DAYS", 14),
  bufferMinutes: int("BUFFER_MINUTES", 15),
  minDurationMin: int("MIN_DURATION_MIN", 20),
  weekdaysOnly: (process.env.WEEKDAYS_ONLY ?? "true").toLowerCase() !== "false",
  skipKeywords: set("SKIP_KEYWORDS", ""),
  skipCalendarIds: set("SKIP_CALENDAR_IDS", "hebcal,holiday,birthdays"),

  // Marker stored on every mirror block so we can find/own it later.
  mirrorMarkerKey: "mirrorSourceId",
};
