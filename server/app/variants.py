"""Other audio versions of a paid clip, converted from the stored MP3 on request.

Which versions a buyer may download follows the plan table on the pricing page:
pay as you go gets MP3; Starter adds WAV, M4A and OGG; Creator and up add the
8 kHz phone-system (IVR) versions. The plan is the buyer's (the job's email),
not whoever holds the link. Versions are made fresh each time and streamed back
(a few MB, under a second of ffmpeg), so nothing extra is stored.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from . import db

logger = logging.getLogger(__name__)

PLAN_ORDER = ["payg", "starter", "creator", "pro", "business"]
PLAN_LABEL = {"payg": "Pay as you go", "starter": "Starter", "creator": "Creator", "pro": "Pro", "business": "Business"}
CONVERT_TIMEOUT = 120


@dataclass(frozen=True)
class Version:
    label: str
    suffix: str
    content_type: str
    args: tuple[str, ...]
    min_plan: str


VERSIONS: dict[str, Version] = {
    "mp3": Version("MP3 · 96 kbps", "mp3", "audio/mpeg", (), "payg"),
    "wav": Version("WAV · 24 kHz 16-bit", "wav", "audio/wav", ("-ar", "24000", "-c:a", "pcm_s16le", "-f", "wav"), "starter"),
    "m4a": Version("M4A (AAC) · 128 kbps", "m4a", "audio/mp4", ("-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-f", "ipod"), "starter"),
    "ogg": Version("OGG Opus · 64 kbps", "ogg", "audio/ogg", ("-c:a", "libopus", "-b:a", "64k", "-f", "ogg"), "starter"),
    "ivr-wav": Version("Phone system WAV · 8 kHz 16-bit", "8khz.wav", "audio/wav", ("-ar", "8000", "-c:a", "pcm_s16le", "-f", "wav"), "creator"),
    "ivr-ulaw": Version("Phone system μ-law · 8 kHz (G.711)", "ulaw.wav", "audio/wav", ("-ar", "8000", "-c:a", "pcm_mulaw", "-f", "wav"), "creator"),
    "ivr-alaw": Version("Phone system A-law · 8 kHz (G.711)", "alaw.wav", "audio/wav", ("-ar", "8000", "-c:a", "pcm_alaw", "-f", "wav"), "creator"),
}


class ConvertError(Exception):
    pass


async def plan_for(email: str | None) -> str:
    """The buyer's active plan, or "payg". Any lookup failure counts as pay as you go."""
    if not email:
        return "payg"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        row = await db.select_one(
            "voice_subscriptions",
            {"email": db.eq(email), "status": "eq.active", "period_end": f"gt.{now}", "select": "plan", "order": "created_at.desc"},
        )
    except db.DbError:
        logger.warning("Could not look up a plan for a download; treating it as pay as you go")
        return "payg"
    plan = (row or {}).get("plan")
    return plan if plan in PLAN_ORDER else "payg"


def allowed(plan: str, version_id: str) -> bool:
    version = VERSIONS.get(version_id)
    if version is None or plan not in PLAN_ORDER:
        return False
    return PLAN_ORDER.index(plan) >= PLAN_ORDER.index(version.min_plan)


def menu(plan: str) -> list[dict]:
    """Every version, with whether this buyer may download it and, if not, which plan unlocks it."""
    return [
        {
            "id": vid,
            "label": v.label,
            "allowed": allowed(plan, vid),
            **({} if allowed(plan, vid) else {"needs": PLAN_LABEL[v.min_plan]}),
        }
        for vid, v in VERSIONS.items()
    ]


def file_name(job: dict, version_id: str) -> str:
    return f"mikaka-voice-{job.get('licence_id') or job['id']}.{VERSIONS[version_id].suffix}"


async def convert(mp3: bytes, version_id: str) -> bytes:
    """Our own stored MP3 -> the requested version (mono throughout)."""
    version = VERSIONS[version_id]
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.mp3"
        out = Path(tmp) / f"out.{version.suffix.rsplit('.', 1)[-1]}"
        src.write_bytes(mp3)
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(src), "-ac", "1", *version.args, str(out),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
            env={"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")},
        )
        try:
            _, err = await asyncio.wait_for(proc.communicate(), CONVERT_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise ConvertError("conversion took too long")
        if proc.returncode != 0 or not out.exists():
            raise ConvertError(err.decode(errors="replace")[-300:])
        return out.read_bytes()
