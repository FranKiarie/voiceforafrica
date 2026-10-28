-- Guards from the transcription review (2026-10-29):
-- upload_generation: the exact Cloud Storage object that was measured and priced;
--   the transcription reads only that generation, so a file swapped after the
--   quote cannot be transcribed.
-- attempts: runs started for a paid row; after 3 the row fails instead of
--   looping (and paying Gemini) forever.
alter table public.voice_transcripts add column if not exists upload_generation bigint;
alter table public.voice_transcripts add column if not exists attempts int not null default 0;
