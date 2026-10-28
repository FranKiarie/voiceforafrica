"""Transcription endpoints: upload link, quote, checkout and status.

1. POST /transcripts/uploads   -> a signed PUT URL into the private upload bucket
2. (browser PUTs the file straight to Cloud Storage)
3. POST /transcripts/{id}/quote -> the server reads the length itself and prices it
4. POST /transcripts/{id}/checkout -> a Paystack access code for that price
5. GET  /transcripts/{id}       -> verify-by-reference, progress, then the documents

The length is measured by ffprobe on the stored file, never taken from the
browser, so the price cannot be talked down. Pay as you go, no account needed.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import db, gcs, paystack, transcripts
from .config import settings
from .pricing import MAX_TRANSCRIBE_SECONDS, MAX_UPLOAD_BYTES, transcribe_quote
from .transcribe import FORMATS, LANGUAGES, probe

logger = logging.getLogger(__name__)

router = APIRouter()

UPLOADS_PER_EMAIL_PER_HOUR = 10
MIN_UPLOAD_BYTES = 1024
NOT_FOUND = "Transcript not found."
# Measuring reads the whole file; two at a time keeps memory and CPU in hand.
_MEASURE_GATE = asyncio.Semaphore(2)
# access_code while checkout is talking to Paystack: quotes can no longer change the price.
STARTING = "starting"


class UploadIn(BaseModel):
    fileName: str = ""
    size: int = 0
    email: str = ""
    language: str = ""
    speakers: bool = True


def _hours(seconds: float) -> str:
    total = int(round(seconds))
    h, rem = divmod(total, 3600)
    m = rem // 60
    return f"{h} h {m:02d} min" if h else f"{m} min"


def _extension(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


async def _row(tid: str) -> dict:
    row = await transcripts.load(tid)
    if not row:
        raise HTTPException(404, NOT_FOUND)
    return row


def _quote_out(row: dict) -> dict:
    return {
        "transcriptId": row["id"],
        "seconds": row.get("audio_seconds"),
        "minutes": row.get("billed_minutes"),
        "amountUsd": float(row["amount_usd"]) if row.get("amount_usd") is not None else None,
        "amountKes": row.get("amount_kes"),
    }


@router.post("/transcripts/uploads")
async def create_upload(body: UploadIn) -> dict:
    name = (body.fileName or "").strip().replace("/", "_").replace("\\", "_")[:200]
    ext = _extension(name)
    if ext not in FORMATS:
        raise HTTPException(400, "Upload MP3, M4A, AAC, WAV, FLAC, OGG, OPUS, WEBM, AMR, AIFF, MP4 or MOV.")
    if body.size < MIN_UPLOAD_BYTES:
        raise HTTPException(400, "That file is empty.")
    if body.size > MAX_UPLOAD_BYTES:
        raise HTTPException(400, "Files can be up to 500 MB. Save it as MP3 or M4A first (3 hours of MP3 is about 170 MB).")
    email = db.clean_email(body.email)
    if email is None:
        raise HTTPException(400, "Enter a valid email address.")
    language = (body.language or "").strip().lower()
    if language and language not in LANGUAGES:
        raise HTTPException(400, "Choose a listed language, or Detect automatically.")

    since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    try:
        recent = await db.count(transcripts.TABLE, {"email": db.eq(email), "created_at": f"gte.{since}"})
    except db.DbError:
        logger.exception("Could not count recent transcript uploads")
        raise HTTPException(503, "We could not start the upload. Please try again.")
    if recent >= UPLOADS_PER_EMAIL_PER_HOUR:
        raise HTTPException(429, "Too many uploads. Please wait a little and try again.")

    tid = "vt_" + secrets.token_hex(12)
    path = f"uploads/{tid}.{ext}"
    content_type = FORMATS[ext]
    try:
        url, headers = await gcs.upload_url(path, content_type)
    except Exception:  # noqa: BLE001
        logger.exception("Could not sign an upload URL for %s", tid)
        raise HTTPException(503, "Uploads are not available right now. Please try again shortly.")
    await db.insert(
        transcripts.TABLE,
        {
            "id": tid,
            "email": email,
            "file_name": name,
            "file_bytes": int(body.size),
            "content_type": content_type,
            "upload_path": path,
            "language": language or None,
            "speakers": bool(body.speakers),
            "status": "uploading",
        },
    )
    return {"transcriptId": tid, "uploadUrl": url, "contentType": content_type, "uploadHeaders": headers}


@router.post("/transcripts/{tid}/quote")
async def quote_upload(tid: str) -> dict:
    row = await _row(tid)
    if row.get("status") not in ("uploading", "paying"):
        raise HTTPException(409, "This transcript is already paid for.")
    if row.get("access_code"):
        return _quote_out(row)  # checkout started: the price is fixed
    try:
        stored = await gcs.stat(row["upload_path"])
    except Exception:  # noqa: BLE001
        logger.exception("Could not read the upload for %s", tid)
        raise HTTPException(503, "We could not check your file. Please try again.")
    if not stored:
        raise HTTPException(400, "We did not receive the file. Please upload it again.")
    size, generation = stored
    if size > MAX_UPLOAD_BYTES:
        await gcs.delete(row["upload_path"])
        raise HTTPException(400, "Files can be up to 500 MB.")
    if row.get("upload_generation") == generation and row.get("amount_kes"):
        return _quote_out(row)  # this exact file was measured already
    async with _MEASURE_GATE:
        measured = await probe(await gcs.read_url(row["upload_path"], generation))
    if not measured.audio:
        raise HTTPException(400, "We could not find any sound in this file. Check it has an audio track.")
    if measured.seconds is None:
        raise HTTPException(400, "We could not read this file. Save it as MP3, M4A or WAV and try again.")
    if measured.seconds > MAX_TRANSCRIBE_SECONDS + 1:
        raise HTTPException(400, f"This recording is {_hours(measured.seconds)} long. The most we take is 3 hours, so trim or split it first.")
    q = transcribe_quote(measured.seconds)
    # access_code still null: a checkout started meanwhile keeps the price it was given.
    rows = await db.update(
        transcripts.TABLE,
        {"id": db.eq(tid), "access_code": "is.null"},
        {
            "file_bytes": size,
            "upload_generation": generation,
            "audio_seconds": q["seconds"],
            "billed_minutes": q["minutes"],
            "amount_usd": q["usd"],
            "amount_kes": q["kes"],
            "status": "paying",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return _quote_out(rows[0] if rows else await _row(tid))


@router.post("/transcripts/{tid}/checkout")
async def checkout(tid: str):
    row = await _row(tid)
    if row.get("status") != "paying" or not row.get("amount_kes"):
        raise HTTPException(409, "Get a price for this file first.")
    if not paystack.is_configured():
        return JSONResponse({"detail": "Payments are not switched on yet."}, status_code=503)
    if row.get("access_code") and row["access_code"] != STARTING:
        return {**_quote_out(row), "accessCode": row["access_code"]}
    # Claim the row at this exact price before talking to Paystack, so a quote
    # landing meanwhile cannot change the amount under the transaction.
    claimed = await db.update(
        transcripts.TABLE,
        {"id": db.eq(tid), "status": "eq.paying", "access_code": "is.null", "amount_kes": db.eq(row["amount_kes"])},
        {"access_code": STARTING},
    )
    if not claimed:
        raise HTTPException(409, "The price was just updated. Please check it and press Pay again.")
    try:
        tx = await paystack.initialize_transaction(
            email=row["email"],
            amount_subunits=int(row["amount_kes"]) * 100,
            currency="KES",
            reference=tid,
            callback_url=f"{settings.public_site_url}/transcribe/{tid}",
            metadata={"purpose": "vt_transcript", "transcript_id": tid},
            channels=["mobile_money", "card"],
        )
    except (paystack.PaystackNotConfigured, paystack.PaystackError) as exc:
        await db.update(transcripts.TABLE, {"id": db.eq(tid), "access_code": db.eq(STARTING)}, {"access_code": None})
        if isinstance(exc, paystack.PaystackNotConfigured):
            return JSONResponse({"detail": "Payments are not switched on yet."}, status_code=503)
        logger.warning("transcript checkout %s failed to start: %s", tid, exc)
        raise HTTPException(502, "We could not start the payment. Please try again.")
    code = tx.get("access_code")
    await db.update(transcripts.TABLE, {"id": db.eq(tid), "access_code": db.eq(STARTING)}, {"access_code": code})
    return {**_quote_out(row), "accessCode": code}


@router.get("/transcripts/{tid}")
async def status(tid: str) -> dict:
    row = await _row(tid)
    if row.get("status") == "paying" and paystack.is_configured():
        row = await transcripts.refresh_payment(row)
    elif row.get("status") == "transcribing":
        await transcripts.resume_if_stuck(row)
    out = {
        **_quote_out(row),
        "status": row["status"],
        "fileName": row.get("file_name"),
        # paying without a checkout means nobody pressed Pay: nothing to confirm.
        "checkoutStarted": bool(row.get("access_code")) and row.get("access_code") != STARTING,
    }
    if row.get("status") == "ready":
        out["words"] = row.get("words")
        try:
            out["downloads"] = await transcripts.links(row)
            out["preview"], out["previewTruncated"] = await transcripts.preview(row)
        except db.DbError:
            logger.exception("Could not sign transcript %s", tid)
            raise HTTPException(503, "Your transcript is ready, but we could not load it. Please refresh.")
    elif row.get("status") == "failed":
        out["error"] = "We could not finish this transcript. We will refund you; reply to your receipt email."
    return out
