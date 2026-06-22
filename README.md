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

It **self-heals** (move or delete the source event and the block follows) and
**de-dupes** (never stacks blocks).

---

## Two modes — pick one

| | [**`polling/`**](polling) | [**`webhook/`**](webhook) |
|---|---|---|
| How | a script on a schedule | Google push notifications |
| Latency | your poll interval (minutes) | **seconds** |
| Works while your machine is off | no | **yes** |
| Infra | cron / launchd on any machine | Vercel + Supabase + a verified domain |
| Setup | a few minutes | ~20 minutes |
| Best for | simplest possible setup | always-on, near-instant mirroring |

Both share the same behavior and privacy model — only generic busy-blocks ever
reach the target calendar. Start with **polling** if you just want it working;
move to **webhook** when you want it instant and always-on.

- **[`polling/`](polling)** — one Python script. Credentials and state stay local. → [setup](polling/README.md)
- **[`webhook/`](webhook)** — a Next.js app on Vercel that subscribes to calendar
  push events and reconciles via an incremental sync token. → [setup](webhook/README.md)

---

## Security & privacy

- **No secrets in the repo.** `client_secret.json`, `token.json`, and `.env` are
  git-ignored; nothing personal is hard-coded — it's all config.
- **Least detail crosses over.** The target calendar only sees the generic
  `MIRROR_TITLE`; the real event's title, attendees, and notes never leave the
  source calendar. Blocks are created with `visibility: private`.
- **Calendar-only credentials.** The webhook mode mints a calendar-scoped token
  so the credential it stores has the smallest possible blast radius.
- **Revoke anytime** from your [Google Account permissions](https://myaccount.google.com/permissions).

---

## License

MIT — see [LICENSE](LICENSE). Built by [@eitansaban](https://github.com/eitansaban).
