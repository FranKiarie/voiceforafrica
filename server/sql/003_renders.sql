-- Render cache: one stored MP3 per (model, voice, delivery note, words), so the
-- same audio is never made twice. Paid renders reuse the preview's opening.
create table if not exists public.voice_renders (
  cache_key text primary key,              -- sha256 of model, voice, style and text
  storage_path text not null,              -- renders/<cache_key>.mp3 in voice-audio
  seconds int not null,
  voice_id text not null,
  language text not null,
  purpose text not null,
  chars int not null,
  created_at timestamptz not null default now()
);

alter table public.voice_renders enable row level security;
grant select, insert, update, delete on public.voice_renders to service_role;
