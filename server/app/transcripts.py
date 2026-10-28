"""Transcription lifecycle: uploading -> paying -> transcribing -> ready | failed.

The id (vt_...) doubles as the Paystack reference. As with voice jobs, a row is
only marked paid when Paystack's amount and currency match our quote, and the
paying -> transcribing step is a conditional update, so the webhook and the
status poll can both try it and only one wins.

A transcription runs as an in-process task and touches updated_at every minute;
a "transcribing" row untouched for STUCK_AFTER is claimed and run again. The
finished documents go to Supabase storage; the customer's original audio is
deleted from the upload bucket once they are stored.

Logs carry transcript ids only, never customer emails.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import httpx

from . import db, gcs, paystack, transcribe
from .config import settings
from .jobs import _safe_error, payment_matches, spawn

logger = logging.getLogger(__name__)

TABLE = "voice_transcripts"
STUCK_AFTER = timedelta(minutes=5)
HEARTBEAT_SECONDS = 60
SIGNED_URL_SECONDS = 7 * 24 * 3600
PREVIEW_CHARS = 4000
MAX_ATTEMPTS = 3
KEEPALIVE_SECONDS = 30
_RUN_GATE = asyncio.Semaphore(1)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_id(value: str | None) -> bool:
    return db.is_ref_id(value) and str(value).startswith("vt_")


async def load(tid: str) -> dict | None:
    if not is_id(tid):
        return None
    return await db.select_one(TABLE, {"id": db.eq(tid), "select": "*"})


async def refresh_payment(row: dict) -> dict:
    """Ask Paystack about a row still marked paying; returns the fresh row."""
    if row.get("status") != "paying" or not row.get("access_code"):
        return row
    try:
        tx = await paystack.verify_transaction(row["id"])
    except paystack.PaystackError as exc:
        logger.info("verify %s not settled yet: %s", row["id"], exc)
        return row
    if str(tx.get("status") or "") == "success":
        if payment_matches(row, tx):
            await mark_paid_and_start(row["id"], tx)
        else:
            logger.error(
                "Transcript %s paid %s %s but quoted KES %s; not starting",
                row["id"], tx.get("amount"), tx.get("currency"), row.get("amount_kes"),
            )
    return await load(row["id"]) or row


async def mark_paid_and_start(tid: str, tx: dict | None) -> bool:
    """paying -> transcribing exactly once, then start the work in the background."""
    if not is_id(tid):
        return False
    if tx is not None:
        row = await load(tid)
        if not row or not payment_matches(row, tx):
            logger.error("Refusing to mark %s paid: amount/currency mismatch or missing row", tid)
            return False
    rows = await db.update(
        TABLE, {"id": db.eq(tid), "status": "eq.paying"}, {"status": "transcribing", "paid_at": _now(), "updated_at": _now()}
    )
    if not rows:
        return False
    spawn(run(tid))
    return True


# ---- resuming work a restart interrupted ----------------------------------------


async def _claim_stuck(cutoff: datetime, tid: str | None = None) -> list[dict]:
    match = {"status": "eq.transcribing", "updated_at": f"lt.{cutoff.isoformat()}"}
    if tid is not None:
        match["id"] = db.eq(tid)
    return await db.update(TABLE, match, {"updated_at": _now()})


async def resume_stuck(*, startup: bool = False) -> list[str]:
    """Re-run paid transcriptions that stalled. Never raises."""
    now = datetime.now(timezone.utc)
    try:
        rows = await _claim_stuck(now if startup else now - STUCK_AFTER)
    except Exception:  # noqa: BLE001 - must never break startup or a poll
        logger.exception("Could not look for stuck transcripts")
        return []
    ids = [str(r.get("id")) for r in rows if is_id(r.get("id"))]
    for tid in ids:
        logger.warning("Resuming stuck transcript %s", tid)
        spawn(run(tid))
    return ids


async def resume_if_stuck(row: dict) -> bool:
    if row.get("status") != "transcribing" or not is_id(row.get("id")):
        return False
    try:
        rows = await _claim_stuck(datetime.now(timezone.utc) - STUCK_AFTER, row["id"])
    except Exception:  # noqa: BLE001
        logger.exception("Could not resume transcript %s", row["id"])
        return False
    if not rows:
        return False
    logger.warning("Resuming stuck transcript %s", row["id"])
    spawn(run(row["id"]))
    return True


async def _heartbeat(tid: str) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        try:
            await db.update(TABLE, {"id": db.eq(tid), "status": "eq.transcribing"}, {"updated_at": _now()})
        except Exception:  # noqa: BLE001
            logger.warning("Heartbeat for transcript %s failed", tid)


# ---- the work ---------------------------------------------------------------


def _paths(tid: str) -> dict[str, str]:
    return {fmt: f"transcripts/{tid}.{fmt}" for fmt in ("txt", "srt", "vtt")}


async def _keepalive() -> None:
    """Cloud Run may stop an instance with no request in flight, background work or
    not; while a transcription runs, a request to our own /health every 30 s keeps it up."""
    if not settings.self_url:
        return
    async with httpx.AsyncClient(timeout=10.0) as client:
        while True:
            await asyncio.sleep(KEEPALIVE_SECONDS)
            try:
                await client.get(f"{settings.self_url.rstrip('/')}/health")
            except httpx.HTTPError:
                pass


async def run(tid: str) -> None:
    """Transcribe, store and finish a paid row. Safe to call more than once."""
    beat: asyncio.Task | None = None
    alive: asyncio.Task | None = None
    row: dict | None = None
    try:
        row = await load(tid)
        if not row or row.get("status") != "transcribing":
            return
        attempts = int(row.get("attempts") or 0) + 1
        await db.update(TABLE, {"id": db.eq(tid), "status": "eq.transcribing"}, {"attempts": attempts, "updated_at": _now()})
        if attempts > MAX_ATTEMPTS:
            # A row that keeps dying (out of memory, a crash mid-run) must not loop and pay Gemini forever.
            raise transcribe.TranscribeError(f"gave up after {MAX_ATTEMPTS} attempts")
        beat = asyncio.create_task(_heartbeat(tid))
        alive = asyncio.create_task(_keepalive())
        async with _RUN_GATE:  # one transcription at a time: memory on a 512 MiB instance
            url = await gcs.read_url(row["upload_path"], row.get("upload_generation"))
            segments, models = await transcribe.transcribe_file(
                url, row.get("language") or None, bool(row.get("speakers")), int(row.get("billed_minutes") or 1) * 60
            )
        title = f"Transcript of {row.get('file_name') or 'your recording'} (Mikaka Voice)"
        docs = {
            "txt": (transcribe.to_txt(segments, title), "text/plain; charset=utf-8"),
            "srt": (transcribe.to_srt(segments), "application/x-subrip; charset=utf-8"),
            "vtt": (transcribe.to_vtt(segments), "text/vtt; charset=utf-8"),
        }
        paths = _paths(tid)
        for fmt, (text, content_type) in docs.items():
            await db.upload(paths[fmt], text.encode("utf-8"), content_type)
        fallback_parts = sum(1 for m in models if m == settings.transcribe_fallback_model)
        await db.update(
            TABLE,
            {"id": db.eq(tid), "status": "eq.transcribing"},
            {
                "status": "ready",
                "text_path": paths["txt"],
                "words": transcribe.word_count(segments),
                "model": ",".join(sorted(set(models))),
                "error": None,
                "updated_at": _now(),
            },
        )
        if fallback_parts:
            logger.info("Transcript %s used the advanced model for %d part(s)", tid, fallback_parts)
        try:
            await gcs.delete(row["upload_path"])
        except Exception:  # noqa: BLE001 - the bucket rule deletes it within a day anyway
            logger.warning("Could not delete the upload for %s", tid)
    except Exception as exc:  # noqa: BLE001 - every failure must land on the row
        logger.exception("Transcript %s failed after payment (KES %s); refund is manual", tid, (row or {}).get("amount_kes"))
        try:
            await db.update(
                TABLE,
                {"id": db.eq(tid), "status": "eq.transcribing"},
                {"status": "failed", "error": _safe_error(exc), "updated_at": _now()},
            )
        except Exception:  # noqa: BLE001
            logger.exception("Could not mark transcript %s failed", tid)
    finally:
        for task in (beat, alive):
            if task is not None:
                task.cancel()


async def links(row: dict) -> dict[str, str]:
    stem = (row.get("file_name") or "transcript").rsplit(".", 1)[0][:80] or "transcript"
    out = {}
    for fmt, path in _paths(row["id"]).items():
        out[fmt] = await db.signed_url(path, SIGNED_URL_SECONDS, download_name=f"{stem}.{fmt}")
    return out


async def preview(row: dict) -> tuple[str, bool]:
    """The start of the plain-text transcript for the page, and whether it was cut short."""
    data = await db.download(row.get("text_path") or _paths(row["id"])["txt"])
    text = data.decode("utf-8", errors="replace")
    return text[:PREVIEW_CHARS], len(text) > PREVIEW_CHARS
