"""Speech to text: ffmpeg cuts an upload into parts, Gemini reads each part.

Each language has a first model (see LANGUAGES). The affordable model, Gemini
3.5 Transcribe, reads most; the advanced model, Gemini 3.8 Flash, asked for
timed JSON segments, reads the languages it does better. Whichever goes first,
the other takes over a part the first cannot do.

Parts are 5 minutes (16 kHz mono MP3, about 1.2 MB) and run one after another,
paced under each model's per-minute limits (Tier 1: 10 requests, and for the
transcribe model 10,000 audio tokens, about 6.5 minutes of sound): one part
a minute, so a 3-hour recording read by the transcribe model takes about 36
minutes.

The advanced model sometimes refuses a piece of audio outright. Sending the same
audio again is refused again (and billed again), so a refused piece is halved and
each half tried on its own; a piece still refused at a minute or so goes to the
transcribe model, and is marked in the transcript if neither can read it.

Speaker labels come per part, so "Speaker 1" in one part is not promised to be
the same person in the next.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import tempfile
import time
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import httpx

from .config import settings
from .pricing import MAX_TRANSCRIBE_SECONDS

logger = logging.getLogger(__name__)

INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
PART_SECONDS = 300
# A refused piece is halved only while each half would still be this long.
MIN_PIECE_SECONDS = 60
# What Gemini counts per second of audio against the per-minute token limit.
AUDIO_TOKENS_PER_SECOND = 25
PRIMARY_ATTEMPTS = 4
FALLBACK_ATTEMPTS = 3
REQUEST_TIMEOUT = 600.0
MAX_RETRY_WAIT = 40.0
NOT_TRANSCRIBED = "[This part could not be transcribed]"

# Accepted uploads: extension -> the Content-Type the browser must PUT with.
FORMATS: dict[str, str] = {
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
    "wav": "audio/wav",
    "flac": "audio/flac",
    "ogg": "audio/ogg",
    "oga": "audio/ogg",
    "opus": "audio/opus",
    "webm": "audio/webm",
    "amr": "audio/amr",
    "aiff": "audio/aiff",
    "aif": "audio/aiff",
    "mp4": "video/mp4",
    "mov": "video/quicktime",
}

# Languages the page offers: our code -> (label, the model that reads it first).
# From our test on African speech (October 2026): told the language, the transcribe
# model did no better than detecting it itself, and told Amharic it dropped most
# of the audio, so it is never told; the choice picks the first model and guides
# the advanced model. The advanced model was clearly better on Amharic, Kikuyu and
# Luganda, and keeps Yoruba's tone marks, which the transcribe model drops.
MAIN = "main"
ADVANCED = "advanced"
LANGUAGES: dict[str, tuple[str, str]] = {
    "en": ("English", MAIN),
    "sw": ("Swahili", MAIN),
    "ha": ("Hausa", MAIN),
    "zu": ("Zulu", MAIN),
    "af": ("Afrikaans", MAIN),
    "ar": ("Arabic", MAIN),
    "fr": ("French", MAIN),
    "pt": ("Portuguese", MAIN),
    "ln": ("Lingala", MAIN),
    "am": ("Amharic", ADVANCED),
    "yo": ("Yoruba", ADVANCED),
    "ig": ("Igbo", ADVANCED),
    "xh": ("Xhosa", ADVANCED),
    "so": ("Somali", ADVANCED),
    "rw": ("Kinyarwanda", ADVANCED),
    "lg": ("Luganda", ADVANCED),
    "ki": ("Kikuyu", ADVANCED),
    "luo": ("Dholuo", ADVANCED),
    "sn": ("Shona", ADVANCED),
    "om": ("Oromo", ADVANCED),
    "ti": ("Tigrinya", ADVANCED),
    "wo": ("Wolof", ADVANCED),
    "tw": ("Twi", ADVANCED),
}


class TranscribeError(Exception):
    def __init__(self, message: str, *, retryable: bool = False, wait: float | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.wait = wait


class Blocked(TranscribeError):
    """The advanced model refused the audio or cut its answer short. The same audio
    is refused again, so it is never re-sent as it is: it is halved instead."""


# ---- staying under the per-minute limits -------------------------------------------


class Pacer:
    """Keeps one model under its per-minute request and audio-token limits.

    Every send is remembered for a minute. A send that would take the last
    minute past 90% of either limit waits until enough earlier sends are older
    than that. A send alone in its minute always goes, so one piece over the
    token budget is still sent rather than waiting forever.
    """

    WINDOW = 60.0

    def __init__(self, requests: int, tokens: int | None = None, *, clock=time.monotonic, sleep=asyncio.sleep) -> None:
        self.requests = max(1, int(requests * 0.9))
        self.tokens = int(tokens * 0.9) if tokens else None
        self.clock = clock
        self.sleep = sleep
        self.sent: deque[tuple[float, int]] = deque()
        self.lock = asyncio.Lock()

    def _delay(self, tokens: int) -> float:
        now = self.clock()
        while self.sent and now - self.sent[0][0] >= self.WINDOW:
            self.sent.popleft()
        if not self.sent:
            return 0.0
        used = sum(n for _, n in self.sent)
        if len(self.sent) < self.requests and (self.tokens is None or used + tokens <= self.tokens):
            return 0.0
        return self.sent[0][0] + self.WINDOW - now + 0.05

    async def wait(self, tokens: int = 0) -> None:
        async with self.lock:
            while (delay := self._delay(tokens)) > 0:
                await self.sleep(delay)
            self.sent.append((self.clock(), tokens))


_PACERS: dict[str, Pacer] = {}


def _pacer(model: str) -> Pacer:
    """One pacer per model for this process (Cloud Run runs a single instance)."""
    if model not in _PACERS:
        if model == settings.transcribe_model:
            _PACERS[model] = Pacer(settings.transcribe_requests_per_minute, settings.transcribe_tokens_per_minute)
        else:
            _PACERS[model] = Pacer(settings.transcribe_fallback_requests_per_minute)
    return _PACERS[model]


def audio_tokens(seconds: float) -> int:
    return int(seconds * AUDIO_TOKENS_PER_SECOND) + 1


@dataclass
class Segment:
    start: float
    end: float
    speaker: str | None
    text: str


# ---- ffmpeg ----------------------------------------------------------------

# Customers' files are untrusted: only real audio/video demuxers may open them, so
# a playlist dressed as .mp3 (HLS, concat) cannot make ffmpeg fetch other files.
# Remote input may only come over https; local files are our own parts.
_FORMATS = "mp3,mov,wav,flac,ogg,matroska,aac,amr,amrnb,amrwb,aiff"
# ffmpeg never sees our keys: it gets a bare environment.
_ENV = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")}
# Measuring stops a little past the limit, so an absurdly long file is refused quickly.
_MEASURE_LIMIT = MAX_TRANSCRIBE_SECONDS + 120


def _safe_input(url: str) -> list[str]:
    protocols = "https,tls,tcp" if url.startswith("https://") else "file"
    return ["-format_whitelist", _FORMATS, "-protocol_whitelist", protocols]


async def _run(args: list[str], timeout: float) -> tuple[int, bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=_ENV
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise TranscribeError(f"{args[0]} took longer than {int(timeout)} s")
    return proc.returncode or 0, out, err


@dataclass
class Probe:
    seconds: float | None  # None: unreadable
    audio: bool = True


async def probe(url: str) -> Probe:
    """The true length of the first audio stream, from its packets, not the header.

    Headers can lie (a WebM saying 5 s around 10 minutes of sound, a VBR MP3
    with no Xing frame) or be missing (browser recordings), so the price comes
    from reading every audio packet without decoding it (stream copy to null).
    """
    code, out, err = await _run(
        [
            "ffmpeg", "-nostdin", "-v", "error", *_safe_input(url), "-i", url,
            "-map", "0:a:0", "-c", "copy", "-t", str(_MEASURE_LIMIT), "-f", "null", "-", "-progress", "pipe:1",
        ],
        300,
    )
    if "matches no streams" in err.decode(errors="replace"):
        return Probe(None, audio=False)
    times = re.findall(r"out_time_us=(\d+)", out.decode(errors="replace"))
    seconds = int(times[-1]) / 1_000_000 if times else 0.0
    return Probe(seconds if code == 0 and seconds > 0 else None)


async def split(url: str, out_dir: str, max_seconds: float) -> list[Path]:
    """16 kHz mono MP3 parts of PART_SECONDS, the sound only, never past what was paid for."""
    pattern = str(Path(out_dir) / "part%03d.mp3")
    code, _, err = await _run(
        [
            "ffmpeg", "-nostdin", "-v", "error", *_safe_input(url), "-i", url,
            "-t", str(min(max_seconds, MAX_TRANSCRIBE_SECONDS)),
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "32k",
            "-f", "segment", "-segment_time", str(PART_SECONDS), "-reset_timestamps", "1", pattern,
        ],
        1800,
    )
    parts = sorted(Path(out_dir).glob("part*.mp3"))
    if code != 0 or not parts:
        raise TranscribeError("Could not read the audio: " + err.decode(errors="replace")[-300:])
    return parts


async def halves(audio: bytes, seconds: float) -> list[tuple[bytes, float, float]]:
    """One of our own MP3 pieces -> its two halves as (audio, start in the piece, length).

    The frames are copied, not re-encoded, so the halves hold exactly the piece's sound.
    """
    out: list[tuple[bytes, float, float]] = []
    with tempfile.TemporaryDirectory() as tmp:
        src = str(Path(tmp) / "piece.mp3")
        Path(src).write_bytes(audio)
        start = 0.0
        for n, window in enumerate((["-t", f"{seconds / 2:.3f}"], ["-ss", f"{seconds / 2:.3f}"])):
            dst = str(Path(tmp) / f"half{n}.mp3")
            code, _, err = await _run(
                ["ffmpeg", "-nostdin", "-v", "error", *_safe_input(src), "-i", src, *window, "-c", "copy", "-f", "mp3", dst],
                120,
            )
            length = (await probe(dst)).seconds if code == 0 else None
            if not length:
                raise TranscribeError("Could not halve a piece: " + err.decode(errors="replace")[-300:])
            out.append((Path(dst).read_bytes(), start, length))
            start += length
    return out


# ---- reading model replies -----------------------------------------------------


def _seconds(raw: object) -> float:
    """'0.300s' or '2s' (or a number) -> seconds."""
    try:
        return float(str(raw).strip().rstrip("s"))
    except ValueError:
        return 0.0


_SENTENCE_END = re.compile(r"[.!?…؟]$")


def group_words(words: list[dict]) -> list[Segment]:
    """Words with times and speakers -> subtitle-sized segments.

    A segment ends on a new speaker, a pause over a second, a sentence end once
    it is 6 s long, or at 15 s whatever comes.
    """
    segments: list[Segment] = []
    current: list[dict] = []

    def close() -> None:
        if current:
            segments.append(
                Segment(
                    start=current[0]["start"],
                    end=current[-1]["end"],
                    speaker=current[0].get("speaker"),
                    text=" ".join(w["text"] for w in current).strip(),
                )
            )
            current.clear()

    for word in words:
        if current:
            length = word["end"] - current[0]["start"]
            if (
                word.get("speaker") != current[0].get("speaker")
                or word["start"] - current[-1]["end"] > 1.0
                or length > 15.0
            ):
                close()
        current.append(word)
        if _SENTENCE_END.search(word["text"]) and word["end"] - current[0]["start"] >= 6.0:
            close()
    close()
    return segments


def _label_speakers(segments: list[Segment]) -> list[Segment]:
    """Model labels (spk:0, Speaker A, ...) -> Speaker 1, 2, ... in order of first word."""
    names: dict[str, str] = {}
    for seg in segments:
        if seg.speaker:
            seg.speaker = names.setdefault(seg.speaker, f"Speaker {len(names) + 1}")
    return segments


def parse_interaction(body: dict, part_seconds: float) -> list[Segment]:
    words: list[dict] = []
    texts: list[str] = []
    for step in body.get("steps") or []:
        for content in step.get("content") or []:
            if content.get("type", "text") != "text":
                continue
            if content.get("text"):
                texts.append(str(content["text"]))
            for note in content.get("annotations") or []:
                if note.get("type") == "word_info" and note.get("text"):
                    words.append(
                        {
                            "text": str(note["text"]),
                            "start": _seconds(note.get("start_offset")),
                            "end": _seconds(note.get("end_offset")),
                            "speaker": note.get("speaker"),
                        }
                    )
    if words:
        return group_words(words)
    text = " ".join(t.strip() for t in texts if t.strip())
    return [Segment(0.0, part_seconds, None, text)] if text else []


def parse_fallback(body: dict, part_seconds: float) -> list[Segment]:
    raw = ""
    candidates = body.get("candidates") or []
    if not candidates:
        reason = (body.get("promptFeedback") or {}).get("blockReason") or "no answer"
        raise Blocked(f"The advanced model refused the audio ({reason})")
    # A reply cut short (token limit, safety, recitation) must not pass as a full part.
    reason = str(candidates[0].get("finishReason") or "STOP")
    if reason not in ("STOP", "FINISH_REASON_UNSPECIFIED"):
        raise Blocked(f"The advanced model stopped early ({reason})")
    for part in (candidates[0].get("content") or {}).get("parts") or []:
        if part.get("text") and not part.get("thought"):
            raw += part["text"]
    try:
        items = json.loads(raw or "[]")
    except ValueError as exc:
        raise TranscribeError("The advanced model returned unreadable JSON", retryable=True) from exc
    segments = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        start = min(max(_seconds(item.get("start")), 0.0), part_seconds)
        end = min(max(_seconds(item.get("end")), start), part_seconds)
        segments.append(Segment(start, end, str(item.get("speaker") or "") or None, text))
    return segments


# ---- model calls -----------------------------------------------------------------


def _retry_wait(text: str) -> float | None:
    match = re.search(r"retry in (\d+(?:\.\d+)?)s", text)
    return min(float(match.group(1)) + 1.0, MAX_RETRY_WAIT) if match else None


def _raise_for(res: httpx.Response, model: str) -> None:
    if res.status_code < 400:
        return
    snippet = res.text[:300]
    retryable = res.status_code == 429 or res.status_code >= 500
    raise TranscribeError(f"{model} failed ({res.status_code}): {snippet}", retryable=retryable, wait=_retry_wait(snippet))


async def _primary(client: httpx.AsyncClient, audio: bytes, speakers: bool, part_seconds: float) -> list[Segment]:
    mode: dict = {"type": "verbatim", "timestamp_granularities": ["word"]}
    if speakers:
        mode["diarization_mode"] = "speaker"
    body = {
        "model": settings.transcribe_model,
        "input": [{"type": "audio", "data": base64.b64encode(audio).decode(), "mime_type": "audio/mp3"}],
        # No language: the model detects it (see LANGUAGES).
        "generation_config": {"transcription_config": {"language_codes": [], "mode": mode}},
    }
    await _pacer(settings.transcribe_model).wait(audio_tokens(part_seconds))
    res = await client.post(INTERACTIONS_URL, json=body, headers={"x-goog-api-key": settings.google_ai_api_key})
    _raise_for(res, settings.transcribe_model)
    return parse_interaction(res.json(), part_seconds)


def _fallback_prompt(language: str | None, speakers: bool) -> str:
    who = (
        'the speaker as "Speaker 1", "Speaker 2" and so on, the same label for the same voice'
        if speakers
        else 'speaker as ""'
    )
    hint = f" The main language is {LANGUAGES[language][0]}." if language in LANGUAGES else ""
    return (
        "Transcribe this audio word for word in the language or languages actually spoken. Keep code-switching "
        "(for example Swahili and English, or Sheng) exactly as said; never translate or summarise." + hint +
        " Return a JSON list of segments in order. Each segment is one sentence or short turn of at most 15 seconds, "
        f"with start and end in seconds from the start of this audio, {who}, and the text. "
        "Return [] if there is no speech."
    )


async def _fallback(client: httpx.AsyncClient, audio: bytes, language: str | None, speakers: bool, part_seconds: float) -> list[Segment]:
    model = settings.transcribe_fallback_model
    body = {
        "contents": [
            {
                "parts": [
                    {"inline_data": {"mime_type": "audio/mp3", "data": base64.b64encode(audio).decode()}},
                    {"text": _fallback_prompt(language, speakers)},
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 65536,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "start": {"type": "NUMBER"},
                        "end": {"type": "NUMBER"},
                        "speaker": {"type": "STRING"},
                        "text": {"type": "STRING"},
                    },
                    "required": ["start", "end", "text"],
                },
            },
        },
    }
    await _pacer(model).wait(audio_tokens(part_seconds))
    res = await client.post(GENERATE_URL.format(model=model), json=body, headers={"x-goog-api-key": settings.google_ai_api_key})
    _raise_for(res, model)
    return parse_fallback(res.json(), part_seconds)


async def _attempts(call, attempts: int) -> list[Segment]:
    last: TranscribeError | None = None
    for attempt in range(attempts):
        try:
            return await call()
        except httpx.HTTPError as exc:
            last = TranscribeError(f"network: {type(exc).__name__}", retryable=True)
        except TranscribeError as exc:
            last = exc
        except (ValueError, KeyError, TypeError, AttributeError) as exc:  # an unreadable reply
            last = TranscribeError(f"unreadable reply: {type(exc).__name__}", retryable=True)
        if not last.retryable or attempt == attempts - 1:
            break
        await asyncio.sleep(last.wait if last.wait is not None else 2.0 * (attempt + 1))
    raise last or TranscribeError("no attempt ran")


def _shift(segments: list[Segment], by: float) -> list[Segment]:
    return [Segment(s.start + by, s.end + by, s.speaker, s.text) for s in segments]


async def transcribe_part(
    client: httpx.AsyncClient, audio: bytes, language: str | None, speakers: bool, part_seconds: float = PART_SECONDS
) -> tuple[list[Segment], list[str]]:
    """One part -> (segments with times from the part's start, models that read it)."""
    main_first = LANGUAGES.get(language or "", ("", MAIN))[1] == MAIN
    models: list[str] = []

    async def primary(piece: bytes, seconds: float) -> list[Segment]:
        segments = await _attempts(lambda: _primary(client, piece, speakers, seconds), PRIMARY_ATTEMPTS)
        if segments:
            models.append(settings.transcribe_model)
        return segments

    async def backup(piece: bytes, seconds: float, *, refused: bool) -> list[Segment]:
        """The transcribe model on a piece the advanced model refused or heard nothing in."""
        try:
            segments = await primary(piece, seconds)
        except Exception as exc:  # noqa: BLE001 - one piece must not fail the whole transcript
            logger.warning("Transcribe model could not read a %d s piece either: %s", seconds, str(exc)[:200])
            segments = []
        if not segments and refused:
            logger.warning("A %d s piece could not be transcribed; it is marked in the transcript", seconds)
            return [Segment(0.0, seconds, None, NOT_TRANSCRIBED)]
        return segments

    async def advanced(piece: bytes, seconds: float) -> list[Segment]:
        try:
            segments = await _attempts(lambda: _fallback(client, piece, language, speakers, seconds), FALLBACK_ATTEMPTS)
        except Blocked as exc:
            if seconds / 2 < MIN_PIECE_SECONDS:
                return await backup(piece, seconds, refused=True)
            logger.info("%s on a %d s piece; trying its halves", exc, seconds)
            try:
                pieces = await halves(piece, seconds)
            except TranscribeError as split_error:
                logger.warning("Could not halve a refused piece: %s", str(split_error)[:200])
                return await backup(piece, seconds, refused=True)
            out: list[Segment] = []
            for half, start, length in pieces:
                out.extend(_shift(await advanced(half, length), start))
            return out
        except Exception as exc:  # noqa: BLE001
            if main_first:  # the transcribe model already had its turn
                raise
            logger.warning("Advanced model failed on a piece, using the transcribe model: %s", str(exc)[:200])
            return await primary(piece, seconds)
        if segments:
            models.append(settings.transcribe_fallback_model)
            return segments
        return [] if main_first else await backup(piece, seconds, refused=False)

    if main_first:
        try:
            segments = await primary(audio, part_seconds)
            if segments:
                return _label_speakers(segments), models
            logger.info("Transcribe model heard nothing in a part; asking the advanced model")
        except Exception as exc:  # noqa: BLE001 - whatever went wrong, the advanced model gets its turn
            logger.warning("Transcribe model failed on a part, using the advanced model: %s", str(exc)[:200])
    segments = await advanced(audio, part_seconds)
    return _label_speakers(segments), list(dict.fromkeys(models))


async def transcribe_file(url: str, language: str | None, speakers: bool, max_seconds: float) -> tuple[list[Segment], list[str]]:
    """The paid-for length of a recording -> (segments with times from its start, models used per part)."""
    if not settings.google_ai_api_key:
        raise TranscribeError("Transcription is not configured")
    out: list[Segment] = []
    models: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        parts = await split(url, tmp, max_seconds)
        timeout = httpx.Timeout(REQUEST_TIMEOUT, connect=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            for index, path in enumerate(parts):
                # The last part can be a sliver with no frames; skip it and use real lengths.
                length = (await probe(str(path))).seconds
                audio = path.read_bytes()
                path.unlink()
                if not length or length < 0.5:
                    continue
                segments, used = await transcribe_part(client, audio, language, speakers, length)
                out.extend(_shift(segments, index * PART_SECONDS))
                models.extend(used)
    return out, models


# ---- documents -------------------------------------------------------------------


def stamp(seconds: float, sep: str = ",", millis: bool = True) -> str:
    total_ms = int(round(max(0.0, seconds) * 1000))
    h, rem = divmod(total_ms, 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}" if millis else f"{h:02d}:{m:02d}:{s:02d}"


def to_txt(segments: list[Segment], title: str) -> str:
    """Paragraphs: consecutive segments of one speaker, timed at their start."""
    lines = [title, ""]
    paragraph: list[Segment] = []

    def close() -> None:
        if paragraph:
            who = f"{paragraph[0].speaker}: " if paragraph[0].speaker else ""
            text = " ".join(s.text for s in paragraph)
            lines.append(f"[{stamp(paragraph[0].start, millis=False)}] {who}{text}")
            lines.append("")
            paragraph.clear()

    for seg in segments:
        if paragraph and (
            seg.speaker != paragraph[0].speaker or seg.start - paragraph[0].start > 60 or seg.start - paragraph[-1].end > 2
        ):
            close()
        paragraph.append(seg)
    close()
    return "\n".join(lines).rstrip() + "\n"


def _cue_text(seg: Segment) -> str:
    return f"{seg.speaker}: {seg.text}" if seg.speaker else seg.text


def to_srt(segments: list[Segment]) -> str:
    cues = []
    for n, seg in enumerate(segments, 1):
        end = seg.end if seg.end > seg.start else seg.start + 1.0
        cues.append(f"{n}\n{stamp(seg.start)} --> {stamp(end)}\n{_cue_text(seg)}\n")
    return "\n".join(cues)


def to_vtt(segments: list[Segment]) -> str:
    cues = ["WEBVTT", ""]
    for seg in segments:
        end = seg.end if seg.end > seg.start else seg.start + 1.0
        cues.append(f"{stamp(seg.start, '.')} --> {stamp(end, '.')}\n{_cue_text(seg)}\n")
    return "\n".join(cues)


def word_count(segments: list[Segment]) -> int:
    return sum(len(seg.text.split()) for seg in segments if seg.text != NOT_TRANSCRIBED)
