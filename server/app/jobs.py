"""Pay-as-you-go job lifecycle: paying -> generating -> ready | failed.

The job id doubles as the Paystack reference. A job is only marked paid after
the amount and currency Paystack reports match what the server quoted, and the
paying -> generating step is a conditional update, so the webhook and the
status poll can both try it and only one wins.

A render runs as an in-process task, so a restart can leave a paid job sitting
in "generating". While a render runs it touches updated_at every minute; a
"generating" row untouched for STUCK_AFTER is claimed (one conditional update,
so only one caller wins) and rendered again. generate() is idempotent: it does
nothing unless the row is still "generating", and when a licence already exists
it finishes the row from that licence instead of rendering twice.

Logs carry job ids only, never customer emails.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from . import db, paystack
from .pricing import VOICES
from .tts import TtsError, render_mp3  # noqa: F401 - TtsError re-exported for callers

logger = logging.getLogger(__name__)

LICENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
SIGNED_URL_SECONDS = 7 * 24 * 3600
STUCK_AFTER = timedelta(minutes=3)
HEARTBEAT_SECONDS = 60

# Strong references so running generations are not garbage collected.
_tasks: set[asyncio.Task] = set()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def spawn(coro) -> asyncio.Task:
    """Run a coroutine in the background, keeping a strong reference until it ends."""
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


def _start_generate(job_id: str) -> None:
    spawn(generate(job_id))


def payment_matches(job: dict, tx: dict | None) -> bool:
    """True when a Paystack transaction pays exactly this job, in KES."""
    if not tx:
        return False
    try:
        amount = int(tx.get("amount") or 0)
    except (TypeError, ValueError):
        return False
    currency = str(tx.get("currency") or "").upper()
    return amount == int(job.get("amount_kes") or 0) * 100 and currency == "KES"


def new_licence_id() -> str:
    year = datetime.now(timezone.utc).year
    return f"VS-{year}-" + "".join(secrets.choice(LICENCE_ALPHABET) for _ in range(6))


def _safe_error(exc: Exception) -> str:
    """Short, user-safe error text: no API keys or tokens."""
    text = f"{type(exc).__name__}: {str(exc)[:200]}"
    text = re.sub(r"(?i)(key|token|secret|authorization)=?[:\s]*[^\s&\"']+", r"\1=[redacted]", text)
    return text


async def load_job(job_id: str) -> dict | None:
    if not db.is_ref_id(job_id) or not job_id.startswith("vj_"):
        return None
    return await db.select_one("voice_jobs", {"id": db.eq(job_id), "select": "*"})


async def refresh_payment(job: dict) -> dict:
    """Ask Paystack about a job still marked paying; returns the fresh row."""
    if job.get("status") != "paying":
        return job
    try:
        tx = await paystack.verify_transaction(job["id"])
    except paystack.PaystackError as exc:
        logger.info("verify %s not settled yet: %s", job["id"], exc)
        return job
    if str(tx.get("status") or "") == "success":
        if payment_matches(job, tx):
            await mark_paid_and_generate(job["id"], tx)
        else:
            logger.error(
                "Job %s paid %s %s but quoted KES %s; not releasing audio",
                job["id"], tx.get("amount"), tx.get("currency"), job.get("amount_kes"),
            )
    return await load_job(job["id"]) or job


async def mark_paid_and_generate(job_id: str, tx: dict | None) -> bool:
    """paying -> generating exactly once, then start the render in the background."""
    if tx is not None:
        job = await load_job(job_id)
        if not job or not payment_matches(job, tx):
            logger.error("Refusing to mark %s paid: amount/currency mismatch or missing job", job_id)
            return False
    if not db.is_ref_id(job_id) or not job_id.startswith("vj_"):
        return False
    rows = await db.update(
        "voice_jobs",
        {"id": db.eq(job_id), "status": "eq.paying"},
        {"status": "generating", "paid_at": _now(), "updated_at": _now()},
    )
    if not rows:
        return False
    _start_generate(job_id)
    return True


# ---- resuming renders a restart interrupted ---------------------------------


async def _claim_stuck(cutoff: datetime, job_id: str | None = None) -> list[dict]:
    """Atomically take over "generating" rows last touched before cutoff."""
    match = {"status": "eq.generating", "updated_at": f"lt.{cutoff.isoformat()}"}
    if job_id is not None:
        match["id"] = db.eq(job_id)
    return await db.update("voice_jobs", match, {"updated_at": _now()})


async def resume_stuck_jobs(*, startup: bool = False) -> list[str]:
    """Re-run paid renders that stalled; returns the job ids it took over.

    startup=True takes over every "generating" row (this process holds no
    renders yet); otherwise only rows untouched for STUCK_AFTER. Never raises.
    """
    now = datetime.now(timezone.utc)
    cutoff = now if startup else now - STUCK_AFTER
    try:
        rows = await _claim_stuck(cutoff)
    except Exception:  # noqa: BLE001 - must never break startup or a poll
        logger.exception("Could not look for stuck voice jobs")
        return []
    ids = [str(r.get("id")) for r in rows if db.is_ref_id(r.get("id"))]
    for job_id in ids:
        logger.warning("Resuming stuck job %s", job_id)
        _start_generate(job_id)
    return ids


async def resume_if_stuck(job: dict) -> bool:
    """For GET /jobs/{id}: take over this one job if its render has stalled."""
    if job.get("status") != "generating" or not db.is_ref_id(job.get("id")):
        return False
    try:
        rows = await _claim_stuck(datetime.now(timezone.utc) - STUCK_AFTER, job["id"])
    except Exception:  # noqa: BLE001
        logger.exception("Could not resume job %s", job["id"])
        return False
    if not rows:
        return False
    logger.warning("Resuming stuck job %s", job["id"])
    _start_generate(job["id"])
    return True


async def _heartbeat(job_id: str) -> None:
    """Keeps updated_at fresh during a long render so nobody takes it over."""
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        try:
            await db.update(
                "voice_jobs", {"id": db.eq(job_id), "status": "eq.generating"}, {"updated_at": _now()}
            )
        except Exception:  # noqa: BLE001
            logger.warning("Heartbeat for job %s failed", job_id)


async def _licence_for(job_id: str) -> dict | None:
    return await db.select_one("voice_licences", {"job_id": db.eq(job_id), "select": "*"})


async def _finish_ready(job_id: str, path: str, seconds: int, licence_id: str) -> None:
    await db.update(
        "voice_jobs",
        {"id": db.eq(job_id), "status": "eq.generating"},
        {
            "status": "ready",
            "audio_path": path,
            "audio_seconds": int(seconds),
            "licence_id": licence_id,
            "error": None,
            "updated_at": _now(),
        },
    )


async def generate(job_id: str) -> None:
    """Render, store and licence a paid job. Safe to call more than once."""
    job: dict | None = None
    beat: asyncio.Task | None = None
    try:
        job = await load_job(job_id)
        if not job:
            raise RuntimeError("job not found")
        if job.get("status") != "generating":
            return
        path = f"clips/{job_id}.mp3"
        existing = await _licence_for(job_id)
        if existing:
            # An earlier run stored the audio and licence but stopped before the row.
            await _finish_ready(job_id, path, int(existing.get("length_seconds") or 0), existing["id"])
            return

        beat = asyncio.create_task(_heartbeat(job_id))
        audio, seconds = await render_mp3(job["script"], job["voice_id"], job["language"])
        await db.upload(path, audio, "audio/mpeg")
        digest = hashlib.sha256(audio).hexdigest()

        licence_id = ""
        for attempt in range(3):
            licence_id = new_licence_id()
            try:
                await db.insert(
                    "voice_licences",
                    {
                        "id": licence_id,
                        "job_id": job_id,
                        "tier": "Commercial",
                        "voice_name": VOICES.get(job["voice_id"], job["voice_id"]),
                        "length_seconds": int(seconds),
                        "audio_sha256": digest,
                        "email": job["email"],
                        "paid_kes": job.get("amount_kes"),
                    },
                )
                break
            except db.DbError as exc:
                if exc.status_code != 409:
                    raise
                # 409 is either a licence-id collision or a parallel run that
                # already licensed this job (job_id is unique): reuse that one.
                other = await _licence_for(job_id)
                if other:
                    licence_id = other["id"]
                    break
                if attempt == 2:
                    raise

        await _finish_ready(job_id, path, int(seconds), licence_id)
    except Exception as exc:  # noqa: BLE001 - every failure must land on the row
        message = _safe_error(exc)
        logger.exception(
            "Job %s failed after payment (KES %s); refund is manual",
            job_id, (job or {}).get("amount_kes"),
        )
        try:
            await db.update(
                "voice_jobs",
                {"id": db.eq(job_id), "status": "eq.generating"},
                {"status": "failed", "error": message, "updated_at": _now()},
            )
        except Exception:  # noqa: BLE001
            logger.exception("Could not mark job %s failed", job_id)
    finally:
        if beat is not None:
            beat.cancel()


async def audio_link(job: dict) -> str | None:
    if job.get("status") != "ready" or not job.get("audio_path"):
        return None
    name = f"mikaka-voice-{job.get('licence_id') or job['id']}.mp3"
    return await db.signed_url(job["audio_path"], SIGNED_URL_SECONDS, download_name=name)


# ---- plan subscriptions -----------------------------------------------------


def _add_months(start: datetime, months: int) -> datetime:
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    days_in_month = [31, 29 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 28,
                     31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
    return start.replace(year=year, month=month, day=min(start.day, days_in_month))


async def load_subscription(sub_id: str) -> dict | None:
    if not db.is_ref_id(sub_id) or not sub_id.startswith("vs_"):
        return None
    return await db.select_one("voice_subscriptions", {"id": db.eq(sub_id), "select": "*"})


async def activate_subscription(sub_id: str, tx: dict) -> bool:
    """pending -> active exactly once, after the amount and currency check.

    Shared by the webhook and the GET /plans/{id} poll.
    """
    sub = await load_subscription(sub_id)
    if not sub:
        logger.error("Paid subscription %s has no row", sub_id)
        return False
    if not payment_matches(sub, tx):
        logger.error(
            "Subscription %s paid %s %s but quoted KES %s; not activating",
            sub_id, tx.get("amount"), tx.get("currency"), sub.get("amount_kes"),
        )
        return False
    start = datetime.now(timezone.utc)
    end = _add_months(start, 12 if sub.get("billing") == "yearly" else 1)
    rows = await db.update(
        "voice_subscriptions",
        {"id": db.eq(sub_id), "status": "eq.pending"},
        {"status": "active", "period_start": start.isoformat(), "period_end": end.isoformat()},
    )
    return bool(rows)


async def refresh_subscription(sub: dict) -> dict:
    """Verify a pending subscription with Paystack by reference; returns the fresh row."""
    if sub.get("status") != "pending":
        return sub
    try:
        tx = await paystack.verify_transaction(sub["id"])
    except paystack.PaystackError as exc:
        logger.info("verify %s not settled yet: %s", sub["id"], exc)
        return sub
    if str(tx.get("status") or "") == "success":
        await activate_subscription(sub["id"], tx)
    return await load_subscription(sub["id"]) or sub
