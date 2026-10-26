-- Mikaka Voice schema (own Supabase project, not Mikaka's database).
-- Only the server (service_role) reads and writes these tables; RLS is on with
-- no policies, so the anon and authenticated roles see nothing.

create table if not exists public.voice_previews (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  ip text,
  voice_id text not null,
  language text not null,
  script_sha256 text not null,
  seconds int not null,
  storage_path text,
  created_at timestamptz not null default now()
);
create index if not exists voice_previews_email_day on public.voice_previews (email, created_at);
create index if not exists voice_previews_ip_day on public.voice_previews (ip, created_at);

create table if not exists public.voice_jobs (
  id text primary key,                       -- also the Paystack reference
  email text not null,
  voice_id text not null,
  language text not null,
  script text not null,
  chars int not null,
  projected_seconds int not null,
  billed_seconds int not null,
  amount_kes int not null,
  amount_usd numeric(10,2) not null,
  status text not null default 'paying' check (status in ('paying','generating','ready','failed')),
  paid_at timestamptz,
  audio_path text,
  audio_seconds int,
  licence_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists voice_jobs_email on public.voice_jobs (email, created_at desc);

create table if not exists public.voice_licences (
  id text primary key,                       -- VS-YYYY-XXXXXX
  job_id text not null unique references public.voice_jobs(id),
  tier text not null default 'Commercial',
  voice_name text not null,
  length_seconds int not null,
  audio_sha256 text,
  email text not null,
  paid_kes int,
  issued_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.voice_subscriptions (
  id text primary key,                       -- also the Paystack reference
  email text not null,
  plan text not null check (plan in ('starter','creator','pro','business')),
  billing text not null check (billing in ('monthly','yearly')),
  method text not null check (method in ('card','mpesa')),
  amount_kes int not null,
  amount_usd numeric(10,2) not null,
  status text not null default 'pending' check (status in ('pending','active','expired','failed')),
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists voice_subscriptions_email on public.voice_subscriptions (email, created_at desc);

-- One row per processed Paystack event, so retries never double-process.
create table if not exists public.voice_webhook_events (
  event_key text primary key,
  received_at timestamptz not null default now()
);

alter table public.voice_previews enable row level security;
alter table public.voice_jobs enable row level security;
alter table public.voice_licences enable row level security;
alter table public.voice_subscriptions enable row level security;
alter table public.voice_webhook_events enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.voice_previews, public.voice_jobs, public.voice_licences,
  public.voice_subscriptions, public.voice_webhook_events
  to service_role;

-- Private bucket for preview and clip audio; served only through signed URLs.
insert into storage.buckets (id, name, public)
values ('voice-audio', 'voice-audio', false)
on conflict (id) do nothing;
