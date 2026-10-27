"""Render cache: the same words, in the same voice, style and model, are made once.

Each render is stored at renders/<key>.mp3 with a voice_renders row. A preview is
cached under the key of its text, and a paid render is the previewed opening
followed by the rest, so paying for a clip reuses the preview instead of making
it again. For a script short enough to preview whole, paying makes no new speech
call at all.

The cache never blocks a render: if it cannot be read or written, the audio is
simply made afresh.
"""

from __future__ import annotations

import hashlib
import json
import logging

from . import db, tts
from .catalog import google_voice, purpose_style

logger = logging.getLogger(__name__)


def cache_key(text: str, voice_id: str, language: str, purpose: str | None) -> str:
    """Everything that changes the audio: model, Google voice, delivery note, words."""
    material = [tts.pick_model(language), google_voice(voice_id), purpose_style(purpose), text]
    return hashlib.sha256(json.dumps(material, ensure_ascii=False).encode("utf-8")).hexdigest()


def cache_path(key: str) -> str:
    return f"renders/{key}.mp3"


async def find(key: str) -> dict | None:
    """The stored render for this key ({storage_path, seconds}), or None."""
    try:
        return await db.select_one("voice_renders", {"cache_key": db.eq(key), "select": "storage_path,seconds"})
    except db.DbError:
        logger.warning("Render cache unavailable; rendering afresh")
        return None


async def remember(key: str, seconds: int, *, voice_id: str, language: str, purpose: str | None, chars: int) -> None:
    """Records audio already uploaded to cache_path(key). Failing to record is not fatal."""
    try:
        await db.insert(
            "voice_renders",
            {
                "cache_key": key,
                "storage_path": cache_path(key),
                "seconds": int(seconds),
                "voice_id": voice_id,
                "language": language,
                "purpose": purpose or "general",
                "chars": chars,
            },
            ignore_duplicates=True,
        )
    except db.DbError:
        logger.warning("Could not record render %s in the cache", key[:12])


async def render_bytes(text: str, voice_id: str, language: str, purpose: str | None) -> tuple[bytes, int]:
    """MP3 bytes and whole seconds for text, from the cache when it is there."""
    key = cache_key(text, voice_id, language, purpose)
    row = await find(key)
    if row:
        try:
            return await db.download(row["storage_path"]), int(row["seconds"])
        except db.DbError:
            logger.warning("Cached render %s could not be read; rendering afresh", key[:12])
    mp3, seconds = await tts.render_mp3(text, voice_id, language, purpose)
    seconds = int(round(seconds))
    try:
        await db.upload(cache_path(key), mp3)
    except db.DbError:
        logger.warning("Could not store render %s in the cache", key[:12])
    else:
        await remember(key, seconds, voice_id=voice_id, language=language, purpose=purpose, chars=len(text))
    return mp3, seconds


async def render_script(script: str, voice_id: str, language: str, purpose: str | None) -> tuple[bytes, int]:
    """A paid render: the previewed opening (normally already cached) plus the rest.

    MP3 frames join cleanly; the cut is at a sentence end, so the encoder's
    few milliseconds of padding land in a natural pause.
    """
    script = (script or "").strip()
    head = tts.preview_text(script)
    rest = script[len(head):].strip() if script.startswith(head) else ""
    if not rest:
        return await render_bytes(script, voice_id, language, purpose)
    first, first_seconds = await render_bytes(head, voice_id, language, purpose)
    second, second_seconds = await render_bytes(rest, voice_id, language, purpose)
    return first + second, first_seconds + second_seconds
