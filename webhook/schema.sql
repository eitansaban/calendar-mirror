-- Singleton state for the event-driven calendar mirror.
-- Holds the Google Calendar incremental syncToken and the active watch channel.
-- Run this once in your Supabase project's SQL editor.

create table if not exists public.calendar_mirror_state (
  id                 smallint primary key default 1,
  sync_token         text,
  channel_id         text,
  resource_id        text,
  channel_expiration timestamptz,
  last_event_at      timestamptz,
  updated_at         timestamptz not null default now(),
  constraint calendar_mirror_state_singleton check (id = 1)
);

insert into public.calendar_mirror_state (id) values (1)
on conflict (id) do nothing;

-- The webhook uses the service-role key (which bypasses RLS); lock everyone else out.
alter table public.calendar_mirror_state enable row level security;
revoke all on public.calendar_mirror_state from anon, authenticated;
