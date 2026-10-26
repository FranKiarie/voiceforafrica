-- What the voice-over is for (radio ad, documentary, ...). It steers the
-- delivery of the paid render the same way it steered the free preview.
alter table public.voice_jobs
  add column if not exists purpose text not null default 'general';
