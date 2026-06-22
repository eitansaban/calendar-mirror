import { google, calendar_v3 } from "googleapis";
import { config } from "./config";

/**
 * Build a Calendar client from a calendar-scoped refresh token held in env.
 * The googleapis OAuth2 client transparently refreshes the access token.
 */
export function getCalendar(): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2(config.clientId(), config.clientSecret());
  auth.setCredentials({ refresh_token: config.refreshToken() });
  return google.calendar({ version: "v3", auth });
}

export type GEvent = calendar_v3.Schema$Event;
