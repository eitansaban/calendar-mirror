# Calendar Mirror — Webhook (real-time) mode

Event-driven version of the mirror. Instead of polling on a schedule, it
subscribes to **Google Calendar push notifications**: the moment your calendar
changes, Google POSTs to a webhook and the matching busy-block is created,
updated, or removed within seconds — even when your laptop is asleep.

```
  Google Calendar ──push──▶  https://your-subdomain/api/calendar-webhook
                                    │ incremental sync (syncToken in Supabase)
                                    ▼
                           create / update / delete the busy-block
                                    │  (invites the target address)
   daily cron ─▶ /api/cron/renew-watch   (re-registers the ~weekly channel)
```

Deploys as a small **Next.js app on Vercel**. State (the incremental `syncToken`
and the active watch channel) lives in one **Supabase** table.

## When to use this vs. the polling version

| | [`../polling`](../polling) | this (`webhook`) |
|---|---|---|
| Latency | minutes (poll interval) | seconds |
| Works while your machine is off | no | yes |
| Infra | a cron on any machine | Vercel + Supabase + a verified domain |
| Setup effort | minutes | ~20 min |

Same mirror behavior and privacy model as the polling version — only generic
busy-blocks ever reach the target calendar.

---

## Setup

### 1. Mint a calendar-only token
```bash
pip install google-auth-oauthlib
python scripts/mint-calendar-token.py /path/to/client_secret.json
```
(Get `client_secret.json` from Google Cloud Console → Credentials → OAuth client
ID → **Desktop app**, with the **Calendar API** enabled.) It prints
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.

### 2. Create the state table
Run [`schema.sql`](schema.sql) in your Supabase project's SQL editor. Grab the
project URL and **service-role** key.

### 3. Deploy + attach a verified domain
```bash
npm install
vercel link
vercel --prod
vercel domains add your-subdomain.example.com   # CNAME it to Vercel
```
Push notifications only deliver to a **domain you've verified** in Google Cloud
Console (*APIs & Services → Domain verification*) — `*.vercel.app` won't work, so
use a subdomain of a domain you own.

### 4. Set environment variables
Copy [`.env.example`](.env.example) into your Vercel project settings — the three
`GOOGLE_*` values, `WEBHOOK_URL`, two random secrets (`WEBHOOK_SECRET`,
`CRON_SECRET`), `MIRROR_INVITE_EMAIL`, and the Supabase pair.

### 5. Register the watch
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-subdomain.example.com/api/cron/renew-watch
curl https://your-subdomain.example.com/api/health
```
`channelActive: true` + `hasSyncToken: true` means it's live. Add a weekday event
on the source calendar and watch the block appear within seconds.

The bundled `vercel.json` runs the renewal cron daily (channels expire ~weekly).

## Endpoints
- `POST /api/calendar-webhook` — Google push receiver (verifies the channel token)
- `GET /api/cron/renew-watch` — re-register channel + re-sweep (cron / manual, Bearer-protected)
- `GET /api/health` — channel + sync status

## Config
Same knobs as the polling version (`MIRROR_TITLE`, `BUFFER_MINUTES`,
`SKIP_KEYWORDS`, …) — see [`.env.example`](.env.example).
