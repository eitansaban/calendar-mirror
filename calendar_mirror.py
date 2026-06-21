#!/usr/bin/env python3
"""
Calendar Mirror
---------------
Mirrors events from one Google Calendar onto another as private "busy" blocks,
so a second calendar (e.g. a work account) always reflects when you're committed
elsewhere — without leaking any titles, attendees, or details.

For each qualifying event on the source calendar it creates a private block on
the same source calendar and *invites* the target address, with a configurable
buffer before/after. It also cleans up its own blocks when the underlying event
moves or is deleted, and de-dupes so it never doubles up.

All configuration comes from environment variables (see .env.example).
No personal data is hard-coded.

Run manually:   python calendar_mirror.py
Or on a schedule via cron / launchd / systemd.
"""

import os
import sys
import base64
import logging
import traceback
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

# Optional: load a local .env if python-dotenv is installed.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


# ── Config (all from environment) ──────────────────────────────────────────────

def _env(key, default=None, required=False):
    val = os.environ.get(key, default)
    if required and not val:
        sys.stderr.write(f"Missing required environment variable: {key}\n")
        sys.exit(1)
    return val


def _env_int(key, default):
    try:
        return int(os.environ.get(key, default))
    except ValueError:
        return int(default)


def _env_set(key, default=""):
    raw = os.environ.get(key, default)
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


# Which calendar to read from. "primary" = the authenticated account's main one.
SOURCE_CALENDAR_ID = _env("SOURCE_CALENDAR_ID", "primary")

# The address to invite onto each mirror block (e.g. your work calendar).
MIRROR_INVITE_EMAIL = _env("MIRROR_INVITE_EMAIL", required=True)

# Where failure / staleness alerts are emailed (defaults to the invite target).
ALERT_EMAIL = _env("ALERT_EMAIL", MIRROR_INVITE_EMAIL)

TIMEZONE = _env("TIMEZONE", "America/Los_Angeles")
MIRROR_TITLE = _env("MIRROR_TITLE", "Personal — Busy")
MIRROR_DESC = _env("MIRROR_DESC", "Personal commitment. Time protected.")

LOOKAHEAD_DAYS = _env_int("LOOKAHEAD_DAYS", 14)
BUFFER_MINUTES = _env_int("BUFFER_MINUTES", 15)
MIN_DURATION_MIN = _env_int("MIN_DURATION_MIN", 20)
STALE_THRESHOLD_HOURS = _env_int("STALE_THRESHOLD_HOURS", 8)

# Only mirror weekday events. Set WEEKDAYS_ONLY=false to mirror every day.
WEEKDAYS_ONLY = _env("WEEKDAYS_ONLY", "true").lower() != "false"

# Skip source events whose title contains any of these words (comma-separated).
SKIP_KEYWORDS = _env_set("SKIP_KEYWORDS", "")

# Skip events organized by these calendars (substring match on organizer email).
SKIP_CALENDAR_IDS = _env_set("SKIP_CALENDAR_IDS", "hebcal,holiday,birthdays")

SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.send",
]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_PATH = os.environ.get("TOKEN_PATH", os.path.join(SCRIPT_DIR, "token.json"))
CREDS_PATH = os.environ.get("CREDS_PATH", os.path.join(SCRIPT_DIR, "client_secret.json"))
LOG_PATH = os.environ.get("LOG_PATH", os.path.join(SCRIPT_DIR, "calendar_mirror.log"))
HEARTBEAT_PATH = os.path.join(SCRIPT_DIR, ".last_successful_run")

TZ = ZoneInfo(TIMEZONE)


# ── Logging ─────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)s  %(message)s",
    handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger(__name__)


# ── Auth ────────────────────────────────────────────────────────────────────────

def _load_creds():
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDS_PATH):
                log.error(f"Missing OAuth client file: {CREDS_PATH}. See README.")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(CREDS_PATH, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())
    return creds


def get_service():
    return build("calendar", "v3", credentials=_load_creds())


# ── Alerting ─────────────────────────────────────────────────────────────────────

def send_alert_email(subject, body):
    """Best-effort alert via the Gmail API using the same credentials."""
    try:
        creds = _load_creds()
        gmail = build("gmail", "v1", credentials=creds)
        msg = MIMEText(body)
        msg["to"] = ALERT_EMAIL
        msg["from"] = ALERT_EMAIL
        msg["subject"] = subject
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        gmail.users().messages().send(userId="me", body={"raw": raw}).execute()
        log.info(f"Alert email sent: {subject}")
    except Exception as e:  # noqa: BLE001 — alerting must never crash the run
        log.error(f"Failed to send alert email: {e}")


def read_heartbeat():
    if not os.path.exists(HEARTBEAT_PATH):
        return None
    try:
        with open(HEARTBEAT_PATH) as f:
            return datetime.fromisoformat(f.read().strip())
    except Exception:
        return None


def write_heartbeat():
    with open(HEARTBEAT_PATH, "w") as f:
        f.write(datetime.now(TZ).isoformat())


def check_staleness():
    last_run = read_heartbeat()
    if last_run is None:
        return
    gap_hours = (datetime.now(TZ) - last_run).total_seconds() / 3600
    if gap_hours > STALE_THRESHOLD_HOURS:
        send_alert_email(
            "[Calendar Mirror] Missed run detected",
            f"Calendar mirror has not run successfully in {gap_hours:.1f} hours.\n"
            f"Last successful run: {last_run.strftime('%Y-%m-%d %I:%M %p %Z')}\n",
        )
        log.warning(f"Staleness alert sent ({gap_hours:.1f}h since last run).")


# ── Helpers ──────────────────────────────────────────────────────────────────────

def now_tz():
    return datetime.now(TZ)


def parse_start(event):
    s = event.get("start", {})
    if "dateTime" in s:
        return datetime.fromisoformat(s["dateTime"]).astimezone(TZ)
    return None  # all-day


def parse_end(event):
    s = event.get("end", {})
    if "dateTime" in s:
        return datetime.fromisoformat(s["dateTime"]).astimezone(TZ)
    return None


def is_weekday(dt):
    return dt.weekday() < 5  # Mon=0 … Fri=4


def duration_minutes(start_dt, end_dt):
    return (end_dt - start_dt).total_seconds() / 60


def title_has_skip_keyword(title):
    lower = (title or "").lower()
    return any(kw in lower for kw in SKIP_KEYWORDS)


def organizer_is_excluded(event):
    org = event.get("organizer", {}).get("email", "")
    return any(skip_id in org.lower() for skip_id in SKIP_CALENDAR_IDS)


def is_mirror_block(event):
    return (event.get("summary") or "").strip() == MIRROR_TITLE


def list_events(service, time_min, time_max, q=None):
    """Fetch all events in range, following pagination."""
    params = dict(
        calendarId=SOURCE_CALENDAR_ID,
        timeMin=time_min.isoformat(),
        timeMax=time_max.isoformat(),
        timeZone=TIMEZONE,
        singleEvents=True,
        orderBy="startTime",
        maxResults=250,
    )
    if q:
        params["q"] = q

    events, page_token = [], None
    while True:
        if page_token:
            params["pageToken"] = page_token
        resp = service.events().list(**params).execute()
        events.extend(resp.get("items", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return events


# ── Main sync ─────────────────────────────────────────────────────────────────────

def run_sync():
    log.info("=" * 60)
    log.info("Calendar mirror started")

    service = get_service()
    now = now_tz()
    scan_from = now.replace(hour=0, minute=0, second=0, microsecond=0)
    scan_to = scan_from + timedelta(days=LOOKAHEAD_DAYS)

    # STEP 1: scan source calendar
    all_events = list_events(service, scan_from, scan_to)
    log.info(f"Scanned {len(all_events)} events over next {LOOKAHEAD_DAYS} days")

    # STEP 2: filter to qualifying source events
    qualifying, skipped = [], []
    for ev in all_events:
        title = ev.get("summary", "")
        if ev.get("status") == "cancelled":
            skipped.append((title, "cancelled"))
            continue
        if is_mirror_block(ev):
            continue  # our own output, not a source

        start_dt, end_dt = parse_start(ev), parse_end(ev)
        if start_dt is None:
            skipped.append((title, "all-day"))
            continue
        if WEEKDAYS_ONLY and not is_weekday(start_dt):
            skipped.append((title, "weekend"))
            continue
        if title_has_skip_keyword(title):
            skipped.append((title, "keyword match"))
            continue
        if organizer_is_excluded(ev):
            skipped.append((title, "excluded calendar"))
            continue
        if duration_minutes(start_dt, end_dt) < MIN_DURATION_MIN:
            skipped.append((title, "too short"))
            continue
        qualifying.append(ev)

    log.info(f"Qualifying source events: {len(qualifying)}")

    # STEP 3: remove stale mirror blocks whose source event is gone
    mirror_blocks = [e for e in list_events(service, scan_from, scan_to, q=MIRROR_TITLE) if is_mirror_block(e)]
    cancelled_count = 0
    for mb in mirror_blocks:
        mb_start, mb_end = parse_start(mb), parse_end(mb)
        if mb_start is None:
            continue
        window_start = mb_start + timedelta(minutes=BUFFER_MINUTES)
        window_end = mb_end - timedelta(minutes=BUFFER_MINUTES)

        source_exists = False
        for ev in all_events:
            if is_mirror_block(ev) or ev.get("status") == "cancelled":
                continue
            ev_start, ev_end = parse_start(ev), parse_end(ev)
            if ev_start is None:
                continue
            if ev_start < window_end and ev_end > window_start:
                source_exists = True
                break

        if not source_exists:
            try:
                service.events().delete(
                    calendarId=SOURCE_CALENDAR_ID, eventId=mb["id"], sendUpdates="all"
                ).execute()
                log.info(f"  Deleted stale mirror block: {mb_start:%a %b %d %I:%M %p}")
                cancelled_count += 1
            except Exception as e:  # noqa: BLE001
                log.error(f"  Failed to delete mirror block {mb['id']}: {e}")

    # STEP 4: create mirror blocks for new qualifying events (de-duped)
    mirror_blocks = [e for e in list_events(service, scan_from, scan_to, q=MIRROR_TITLE) if is_mirror_block(e)]
    created = 0
    for ev in qualifying:
        start_dt, end_dt = parse_start(ev), parse_end(ev)
        mirror_start = start_dt - timedelta(minutes=BUFFER_MINUTES)
        mirror_end = end_dt + timedelta(minutes=BUFFER_MINUTES)

        overlap = False
        for mb in mirror_blocks:
            mb_start, mb_end = parse_start(mb), parse_end(mb)
            if mb_start is None:
                continue
            if mb_start < mirror_end and mb_end > mirror_start:
                overlap = True
                break
        if overlap:
            continue

        body = {
            "summary": MIRROR_TITLE,
            "description": MIRROR_DESC,
            "start": {"dateTime": mirror_start.isoformat(), "timeZone": TIMEZONE},
            "end": {"dateTime": mirror_end.isoformat(), "timeZone": TIMEZONE},
            "attendees": [{"email": MIRROR_INVITE_EMAIL}],
            "visibility": "private",
        }
        try:
            service.events().insert(
                calendarId=SOURCE_CALENDAR_ID, body=body, sendUpdates="all"
            ).execute()
            log.info(f"  Created: {mirror_start:%a %b %d %I:%M %p}–{mirror_end:%I:%M %p}")
            created += 1
        except Exception as e:  # noqa: BLE001
            log.error(f"  Failed to create mirror block: {e}")

    log.info("── Summary ──")
    log.info(f"  scanned={len(all_events)}  qualifying={len(qualifying)}  "
             f"created={created}  removed={cancelled_count}  skipped={len(skipped)}")
    log.info("=" * 60)


if __name__ == "__main__":
    try:
        check_staleness()
        run_sync()
        write_heartbeat()
    except Exception as e:  # noqa: BLE001
        detail = traceback.format_exc()
        log.error(f"Calendar mirror FAILED: {e}\n{detail}")
        send_alert_email(
            "[Calendar Mirror] Run failed",
            f"Calendar mirror did not complete.\n\nError: {e}\n\nTraceback:\n{detail}",
        )
        sys.exit(1)
