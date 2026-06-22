# Calendar Mirror

Keep a second calendar honest about when you're busy — **without leaking what
you're doing.**

If you live in two calendars (say a personal Google account and a work one),
people scheduling on the work calendar can't see your personal commitments, so
they book right over them. Calendar Mirror watches your **source** calendar and,
for every qualifying event, drops a private **"busy" block** that invites your
**target** calendar — with a configurable buffer before and after. The target
only ever sees a generic title like `Personal — Busy`; never the real event,
its attendees, or its details.

```
  Source calendar                         Target calendar
  (e.g. personal)                         (e.g. work)
  ┌─────────────────┐                     ┌─────────────────┐
  │ 2:00 Dentist    │  ──mirror block──▶  │ 1:45 Personal — │
  │                 │   (private, +/-15m) │      Busy       │
  └─────────────────┘                     └─────────────────┘
        the real event stays private; only a generic block crosses over
```

It also **self-heals**: if you move or delete the underlying event, the matching
block is removed on the next run, and it de-dupes so it never stacks blocks.

---

## How it works

One small Python script, run on a schedule:

1. Read the next `LOOKAHEAD_DAYS` of events from `SOURCE_CALENDAR_ID`.
2. Keep events that qualify (long enough, on a weekday, not a skip-keyword, not
   from an excluded calendar).
3. Delete any previously-created blocks whose source event has vanished.
4. Create a private `MIRROR_TITLE` block for each new qualifying event and invite
   `MIRROR_INVITE_EMAIL`, padded by `BUFFER_MINUTES`.

If a run fails — or hasn't succeeded in `STALE_THRESHOLD_HOURS` — it emails you.

---

## Quickstart

### 1. Get Google OAuth credentials (5 min)

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or
   pick) a project and enable the **Google Calendar API** and **Gmail API**.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID →
   Desktop app**.
3. Download the JSON and save it next to the script as **`client_secret.json`**.

> The Gmail scope is only used to email *you* alerts. If you don't want it,
> remove the Gmail scope from `SCOPES` and the alert calls.

### 2. Install + configure

```bash
git clone https://github.com/eitansaban/calendar-mirror.git
cd calendar-mirror
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# edit .env — at minimum set MIRROR_INVITE_EMAIL
```

### 3. First run (does the OAuth handshake)

```bash
python calendar_mirror.py
```

A browser opens once to authorize; a `token.json` is written so future runs are
non-interactive. That's it — check your target calendar.

### 4. Put it on a schedule

- **macOS (launchd):** edit the paths in
  [`com.example.calendar-mirror.plist`](com.example.calendar-mirror.plist), copy
  it to `~/Library/LaunchAgents/`, and `launchctl load` it. The example runs
  every 2 hours, 6 AM–6 PM, Mon–Fri.
- **Linux (cron):**
  ```cron
  0 6-18/2 * * 1-5  cd /path/to/calendar-mirror && .venv/bin/python calendar_mirror.py
  ```

---

## Configuration

Everything is environment-driven (see [`.env.example`](.env.example)):

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

---

## Security & privacy

- **No secrets in the repo.** `client_secret.json`, `token.json`, and `.env` are
  all git-ignored. Nothing personal is hard-coded — it's all config.
- **Least detail crosses over.** The target calendar only sees the generic
  `MIRROR_TITLE`; the real event's title, attendees, and notes never leave the
  source calendar. Blocks are created with `visibility: private`.
- **Local-only credentials.** OAuth tokens live on the machine that runs the
  script; nothing is sent anywhere except Google's APIs.
- **Revoke anytime** from your [Google Account permissions](https://myaccount.google.com/permissions).

---

## License

MIT — see [LICENSE](LICENSE). Built by [@eitansaban](https://github.com/eitansaban).
