# Calendar Mirror — Polling mode

The simple version: one Python script, run on a schedule (cron / launchd /
systemd). No server, no database — credentials and state live on the machine
that runs it. Latency is your poll interval (e.g. a few minutes).

> Prefer near-instant mirroring that works while your machine is off? See the
> [`../webhook`](../webhook) (real-time) mode instead.

## How it works

1. Read the next `LOOKAHEAD_DAYS` of events from `SOURCE_CALENDAR_ID`.
2. Keep events that qualify (long enough, on a weekday, not a skip-keyword, not
   from an excluded calendar).
3. Delete any previously-created blocks whose source event has vanished.
4. Create a private `MIRROR_TITLE` block for each new qualifying event and invite
   `MIRROR_INVITE_EMAIL`, padded by `BUFFER_MINUTES`.

If a run fails — or hasn't succeeded in `STALE_THRESHOLD_HOURS` — it emails you.

## Quickstart

### 1. Google OAuth credentials
1. In the [Google Cloud Console](https://console.cloud.google.com/), enable the
   **Google Calendar API** and **Gmail API**.
2. **Credentials → Create Credentials → OAuth client ID → Desktop app**.
3. Download the JSON and save it here as **`client_secret.json`**.

> The Gmail scope is only used to email *you* alerts. To drop it, remove the
> Gmail scope from `SCOPES` and the alert calls.

### 2. Install + configure
```bash
cd polling
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # edit — at minimum set MIRROR_INVITE_EMAIL
```

### 3. First run (OAuth handshake)
```bash
python calendar_mirror.py
```
A browser opens once; a `token.json` is written for non-interactive future runs.

### 4. Schedule it
- **macOS (launchd):** edit the paths in
  [`com.example.calendar-mirror.plist`](com.example.calendar-mirror.plist), copy
  to `~/Library/LaunchAgents/`, `launchctl load` it. (Example: every 2h, 6 AM–6 PM, Mon–Fri.)
- **Linux (cron):**
  ```cron
  0 6-18/2 * * 1-5  cd /path/to/calendar-mirror/polling && .venv/bin/python calendar_mirror.py
  ```

## Configuration

Environment-driven (see [`.env.example`](.env.example)):

| Variable | Default | What it does |
|---|---|---|
| `MIRROR_INVITE_EMAIL` | **(required)** | Address invited onto every block (your target calendar) |
| `SOURCE_CALENDAR_ID` | `primary` | Calendar to read from |
| `ALERT_EMAIL` | = invite email | Where failure/staleness alerts go |
| `TIMEZONE` | `America/Los_Angeles` | IANA timezone |
| `MIRROR_TITLE` | `Personal — Busy` | Title shown on the target calendar |
| `MIRROR_DESC` | `Personal commitment. Time protected.` | Block description |
| `LOOKAHEAD_DAYS` | `14` | How far ahead to mirror |
| `BUFFER_MINUTES` | `15` | Padding added before/after each event |
| `MIN_DURATION_MIN` | `20` | Ignore events shorter than this |
| `WEEKDAYS_ONLY` | `true` | Only mirror Mon–Fri |
| `STALE_THRESHOLD_HOURS` | `8` | Alert if no success in this many hours |
| `SKIP_KEYWORDS` | _(empty)_ | Skip titles containing any of these words |
| `SKIP_CALENDAR_IDS` | `hebcal,holiday,birthdays` | Skip these organizers (substring match) |
