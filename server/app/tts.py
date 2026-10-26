"""Speech engine: Gemini 3.8 TTS over the Interactions REST stream, no LiveKit.

The request shape, style and SSE parsing are borrowed from Mikaka
services/agent/app/styled_gemini_tts.py; the streaming loop is re-implemented
here with plain httpx so the web backend does not depend on livekit-agents.
Audio arrives as base64 PCM deltas (24 kHz, mono, 16-bit little-endian).
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import re
from typing import AsyncIterator

import httpx
import lameenc

from .config import settings
from .pricing import CHARS_PER_SECOND, PREMIUM_ONLY_LANGS

INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
SAMPLE_RATE = 24000
PREVIEW_SECONDS = 45
PREVIEW_MAX_SECONDS = 60
MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = (1.0, 3.0)
_FLASH_TTS = "gemini-3.8-flash-tts"
_FLASH_LITE_TTS = "gemini-3.8-flash-lite-tts"


class TtsError(Exception):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message[:400])
        self.retryable = retryable


# --- borrowed from Mikaka services/agent/app/styled_gemini_tts.py -----------

def build_speech_style(override: dict | None = None) -> str:
    # The selected regional voice carries accent, gender and speaker identity.
    # Google recommends a short constant style: long persona/pitch/identity
    # instructions compete with the voice reference and increase drift.
    dimensions = {
        "warmth": "Warm, friendly, lively",
        "pace": "clear, natural pace",
        "formality": "conversational",
    }
    override = override if isinstance(override, dict) else {}
    speech = override.get("speech") or {}
    if isinstance(speech, dict):
        for dimension in ("pace", "warmth", "formality"):
            entry = speech.get(dimension)
            if isinstance(entry, dict) and entry.get("instruction"):
                dimensions[dimension] = str(entry["instruction"]).strip()
    return "; ".join(dimensions.values()) + "."


def supported_cascade_model(model: str, primary: object, secondary: object) -> str:
    # Google lists Swahili for Flash TTS, but not Flash-Lite TTS. A bilingual
    # call must not enter the unsupported model when the caller code-switches.
    if model == "gemini-3.8-flash-lite-tts" and any(
        str(code or "").lower().split("-")[0] == "sw" for code in (primary, secondary)
    ):
        return "gemini-3.8-flash-tts"
    return model


def speech_request(*, model: str, voice: str, text: str, style: str) -> dict:
    return {
        "model": model,
        "input": [{"type": "user_input", "content": [{
            "type": "text", "text": text,
            "annotations": [{"type": "speech_metadata", "style": style}],
        }]}],
        "response_format": {"type": "audio", "mime_type": "audio/l16", "sample_rate": 24000},
        "generation_config": {"speech_config": [{"voice": voice}]},
        "stream": True,
        # Each chunk is independent synthesis; no server conversation is needed.
        "store": False,
    }


async def sse_events(lines: AsyncIterator[str]) -> AsyncIterator[dict]:
    data: list[str] = []
    async for line in lines:
        if not line:
            if data:
                payload = "\n".join(data)
                data.clear()
                if payload != "[DONE]":
                    yield json.loads(payload)
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
    if data and "\n".join(data) != "[DONE]":
        yield json.loads("\n".join(data))

# --- end borrowed -----------------------------------------------------------


def _base_lang(language: str | None) -> str:
    return str(language or "").lower().split("-")[0].split("_")[0]


def pick_model(language: str) -> str:
    """Pay as you go always renders on the premium model.

    supported_cascade_model keeps Swahili off Flash-Lite; the extra check covers
    the other languages Flash-Lite does not list (Igbo, Somali, Tigrinya, Sotho).
    """
    model = supported_cascade_model(settings.tts_model_premium, language, None)
    if model == _FLASH_LITE_TTS and _base_lang(language) in PREMIUM_ONLY_LANGS:
        model = _FLASH_TTS
    return model


# --- text shaping ------------------------------------------------------------

_SENTENCE_END = re.compile(r"[.!?…]+[\"'”’)\]]*|\n")
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?…])\s+|(?<=[.!?…][\"'”’)\]])\s+|\s*\n\s*")


def preview_text(script: str) -> str:
    """The free preview's text: about 45 s, cut at a sentence end, never past 60 s.

    Never empty when the script has any non-space text.
    """
    out = _preview_cut((script or "").strip())
    return out or (script or "").strip()[: PREVIEW_MAX_SECONDS * CHARS_PER_SECOND]


def _preview_cut(text: str) -> str:
    target = PREVIEW_SECONDS * CHARS_PER_SECOND  # 675
    cap = PREVIEW_MAX_SECONDS * CHARS_PER_SECOND  # 900
    if len(text) / CHARS_PER_SECOND <= PREVIEW_SECONDS:
        return text
    for match in _SENTENCE_END.finditer(text):
        candidate = text[: match.end()].strip()
        if len(candidate) >= target:
            if len(candidate) <= cap:
                return candidate
            break
    else:
        if len(text) <= cap:
            return text
    head = text[:cap]
    if text[cap:cap + 1].isspace():
        return head.strip()  # already ends on a word boundary
    cut = max(head.rfind(c) for c in " \n\t")
    return (head[:cut] if cut > 0 else head).strip()


def _split_words(sentence: str, max_chars: int) -> list[str]:
    parts: list[str] = []
    current = ""
    for word in sentence.split():
        while len(word) > max_chars:
            if current:
                parts.append(current)
                current = ""
            parts.append(word[:max_chars])
            word = word[max_chars:]
        if not word:
            continue
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= max_chars:
            current = f"{current} {word}"
        else:
            parts.append(current)
            current = word
    if current:
        parts.append(current)
    return parts


def chunk_text(text: str, max_chars: int = 1500) -> list[str]:
    if max_chars < 1:
        raise ValueError("max_chars must be positive")
    pieces: list[str] = []
    for sentence in _SENTENCE_SPLIT.split((text or "").strip()):
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) > max_chars:
            pieces.extend(_split_words(sentence, max_chars))
        else:
            pieces.append(sentence)
    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if not current:
            current = piece
        elif len(current) + 1 + len(piece) <= max_chars:
            current = f"{current} {piece}"
        else:
            chunks.append(current)
            current = piece
    if current:
        chunks.append(current)
    return chunks


# --- synthesis ---------------------------------------------------------------

def _new_client() -> httpx.AsyncClient:
    timeout = float(settings.tts_timeout_seconds)
    return httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=min(10.0, timeout)))


_KEY_SHAPE = re.compile(r"AIza[0-9A-Za-z_\-]{20,}")


def _redact(text: str) -> str:
    """Strip the API key (and anything shaped like a Google key) from error text."""
    key = settings.google_ai_api_key
    if key:
        text = text.replace(key, "[redacted]")
    return _KEY_SHAPE.sub("[redacted]", text)


async def _synthesize_chunk(client: httpx.AsyncClient, text: str, voice_id: str, model: str) -> bytes:
    loop = asyncio.get_running_loop()
    timeout = float(settings.tts_timeout_seconds)
    phase = "first audio"
    progress_deadline = loop.time() + timeout
    audio = bytearray()
    try:
        # timeout is a silence budget between audio deltas; the outer bound
        # stops an endless stream on a long chunk.
        async with asyncio.timeout(max(60.0, timeout * 10)):
            async with client.stream(
                "POST", INTERACTIONS_URL,
                headers={"x-goog-api-key": settings.google_ai_api_key},
                json=speech_request(model=model, voice=voice_id, text=text, style=build_speech_style()),
                timeout=timeout,
            ) as response:
                if response.is_error:
                    # Keep diagnostics bounded and never include headers or keys.
                    await response.aread()
                    try:
                        error = response.json().get("error") or {}
                    except (ValueError, AttributeError):
                        error = {}
                    message = str(error.get("message") or "") if isinstance(error, dict) else ""
                    message = _redact(message[:600])
                    status = response.status_code
                    raise TtsError(
                        f"Gemini speech request failed ({status}): {message}"[:400],
                        retryable=status in {429, 499} or status >= 500,
                    )
                completed = False
                events = sse_events(response.aiter_lines())
                while True:
                    remaining = progress_deadline - loop.time()
                    if remaining <= 0:
                        raise TimeoutError
                    try:
                        event = await asyncio.wait_for(anext(events), remaining)
                    except StopAsyncIteration:
                        break
                    kind = event.get("event_type")
                    if kind in ("error", "interaction.failed"):
                        raise TtsError("Gemini speech stream failed", retryable=True)
                    if kind == "interaction.completed":
                        completed = True
                        break
                    delta = event.get("delta") or {}
                    if kind != "step.delta" or delta.get("type") != "audio" or not delta.get("data"):
                        continue
                    mime = str(delta.get("mime_type") or "audio/l16").lower()
                    if mime.split(";")[0].strip() not in {"audio/l16", "audio/pcm"}:
                        raise TtsError("Gemini speech returned an unexpected encoding", retryable=False)
                    pcm = base64.b64decode(delta["data"], validate=True)
                    if pcm:
                        # Treated as little-endian PCM, as Mikaka does.
                        audio.extend(pcm)
                        phase = "audio progress"
                        progress_deadline = loop.time() + timeout
                if not audio or not completed:
                    raise TtsError("Gemini speech stream ended without complete audio", retryable=True)
    except TtsError:
        raise
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise TtsError(f"Gemini speech {phase} timed out", retryable=True) from exc
    except (httpx.HTTPError, ValueError, binascii.Error) as exc:
        raise TtsError("Gemini speech stream could not be decoded", retryable=True) from exc
    return bytes(audio)


async def synthesize_pcm(text: str, voice_id: str, model: str) -> bytes:
    if not settings.google_ai_api_key:
        raise TtsError("Voice service not configured", retryable=False)
    chunks = chunk_text(text)
    if not chunks:
        raise TtsError("Nothing to read", retryable=False)
    out = bytearray()
    async with _new_client() as client:
        for chunk in chunks:
            for attempt in range(MAX_ATTEMPTS):
                try:
                    out.extend(await _synthesize_chunk(client, chunk, voice_id, model))
                    break
                except TtsError as exc:
                    if not exc.retryable or attempt == MAX_ATTEMPTS - 1:
                        raise
                    await asyncio.sleep(_BACKOFF_SECONDS[min(attempt, len(_BACKOFF_SECONDS) - 1)])
    return bytes(out)


def encode_mp3(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    if len(pcm) % 2:
        pcm = pcm[:-1]
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(96)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(2)
    return bytes(encoder.encode(pcm)) + bytes(encoder.flush())


def pcm_seconds(pcm: bytes, sample_rate: int = SAMPLE_RATE) -> int:
    return round(len(pcm) / 2 / sample_rate)


async def render_mp3(text: str, voice_id: str, language: str) -> tuple[bytes, int]:
    model = pick_model(language)
    pcm = await synthesize_pcm(text, voice_id, model)
    return encode_mp3(pcm), pcm_seconds(pcm)
