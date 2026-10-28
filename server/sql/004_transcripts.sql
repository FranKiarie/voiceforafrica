-- Transcription: one row per uploaded recording. The id (vt_...) is also the
-- Paystack reference. The audio itself sits in the private Cloud Storage bucket
-- until the transcript is stored; the documents go to voice-audio/transcripts/.
create table if not exists public.voice_transcripts (
  id text primary key,
  email text not null,
  file_name text not null,
  file_bytes bigint not null,
  content_type text not null,
  upload_path text not null,                 -- uploads/<id>.<ext> in the upload bucket
  language text,                             -- our hint code, null = detect
  speakers boolean not null default true,
  audio_seconds int,                         -- measured by ffprobe, never by the browser
  billed_minutes int,
  amount_kes int,
  amount_usd numeric(10,2),
  access_code text,                          -- set once checkout starts; the price is then fixed
  status text not null default 'uploading'
    check (status in ('uploading','paying','transcribing','ready','failed')),
  paid_at timestamptz,
  model text,                                -- model(s) that did the parts
  text_path text,
  words int,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists voice_transcripts_email on public.voice_transcripts (email, created_at desc);
create index if not exists voice_transcripts_status on public.voice_transcripts (status, updated_at);

alter table public.voice_transcripts enable row level security;
grant select, insert, update, delete on public.voice_transcripts to service_role;
