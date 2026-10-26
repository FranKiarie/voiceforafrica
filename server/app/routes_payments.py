"""Checkout, status polling and the Paystack webhook.

Payments run on Mikaka's Paystack account, whose webhook points at Mikaka's
own backend, so in practice the source of truth is verify-by-reference when
the browser polls GET /jobs/{id} or GET /plans/{id}. The webhook below is kept
for completeness and uses the same guarded code paths. In every path the
reference prefix (vj_ / vs_) and our own row decide what was bought; Paystack
metadata is only a hint.

Webhook idempotency comes from the atomic status transitions (paying ->
generating, pending -> active). An event is recorded in voice_webhook_events
only after it was handled; if handling fails we answer 500 so Paystack retries.

Checkout is rate-limited per email (CHECKOUTS_PER_EMAIL_PER_HOUR). There is no
per-IP limit yet: voice_jobs and voice_subscriptions have no ip column.
Logs carry job/checkout ids only, never customer emails.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from . import db, jobs, paystack
from .config import settings
from .catalog import public_voice_id, purpose_or_default
from .pricing import MAX_PAYG_CHARS, PLAN_USD, plan_amount, quote

logger = logging.getLogger(__name__)

router = APIRouter()

LANG_RE = re.compile(r"^[a-z]{2,3}$")  # same rule as routes_public
NOT_SWITCHED_ON = "Payments are not switched on yet."
CHECKOUTS_PER_EMAIL_PER_HOUR = 10
TOO_MANY_CHECKOUTS = "Too many checkout attempts. Please wait a little and try again."


class PaygCheckout(BaseModel):
    model_config = ConfigDict(extra="ignore")  # e.g. a stale previewId from older clients

    script: str
    voiceId: str
    language: str
    email: str
    purpose: str = ""


class PlanCheckout(BaseModel):
    plan: str
    billing: str
    email: str
    method: str


def _clean_email(raw: str) -> str:
    email = db.clean_email(raw)
    if email is None:
        raise HTTPException(400, "Enter a valid email address.")
    return email


async def _check_checkout_rate(table: str, email: str) -> None:
    """At most CHECKOUTS_PER_EMAIL_PER_HOUR rows created for this email in the last hour."""
    since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    try:
        recent = await db.count(table, {"email": db.eq(email), "created_at": f"gte.{since}"})
    except db.DbError:
        logger.exception("Could not count recent %s checkouts", table)
        raise HTTPException(503, "We could not start the payment. Please try again.")
    if recent >= CHECKOUTS_PER_EMAIL_PER_HOUR:
        raise HTTPException(429, TOO_MANY_CHECKOUTS)


def _not_configured() -> JSONResponse:
    return JSONResponse({"detail": NOT_SWITCHED_ON}, status_code=503)


@router.post("/payg/checkout")
async def payg_checkout(body: PaygCheckout):
    script = (body.script or "").strip()
    if len(script) < 20:
        raise HTTPException(400, "The script needs at least 20 characters.")
    if len(script) > MAX_PAYG_CHARS:
        raise HTTPException(400, f"The script can be at most {MAX_PAYG_CHARS} characters.")
    voice_id = public_voice_id(body.voiceId)
    if not voice_id:
        raise HTTPException(400, "Choose one of the listed voices.")
    language = (body.language or "").strip().lower()
    if not LANG_RE.match(language):
        raise HTTPException(400, "Choose a language.")
    email = _clean_email(body.email)
    if not paystack.is_configured():
        return _not_configured()
    await _check_checkout_rate("voice_jobs", email)

    q = quote(script)
    job_id = "vj_" + secrets.token_hex(12)
    await db.insert(
        "voice_jobs",
        {
            "id": job_id,
            "email": email,
            "voice_id": voice_id,
            "language": language,
            "purpose": purpose_or_default(body.purpose),
            "script": script,
            "chars": q["chars"],
            "projected_seconds": q["projected_seconds"],
            "billed_seconds": q["billed_seconds"],
            "amount_kes": q["kes"],
            "amount_usd": q["usd"],
            "status": "paying",
        },
    )
    try:
        tx = await paystack.initialize_transaction(
            email=email,
            amount_subunits=q["kes"] * 100,
            currency="KES",
            reference=job_id,
            callback_url=f"{settings.public_site_url}/ready",
            metadata={"purpose": "payg_job", "job_id": job_id},
            channels=["mobile_money", "card"],
        )
    except paystack.PaystackNotConfigured:
        return _not_configured()
    except paystack.PaystackError as exc:
        logger.warning("payg checkout %s failed to start: %s", job_id, exc)
        raise HTTPException(502, "We could not start the payment. Please try again.")
    return {"jobId": job_id, "amountKes": q["kes"], "accessCode": tx.get("access_code")}


@router.get("/jobs/{job_id}")
async def job_status(job_id: str):
    if not db.is_ref_id(job_id) or not job_id.startswith("vj_"):
        raise HTTPException(404, "Job not found.")
    job = await jobs.load_job(job_id)
    if not job:
        raise HTTPException(404, "Job not found.")
    if job.get("status") == "paying" and paystack.is_configured():
        job = await jobs.refresh_payment(job)
    elif job.get("status") == "generating":
        await jobs.resume_if_stuck(job)
    out: dict = {"jobId": job["id"], "status": job["status"]}
    if job.get("audio_seconds") is not None:
        out["seconds"] = job["audio_seconds"]
    if job.get("licence_id"):
        out["licenceId"] = job["licence_id"]
    if job.get("status") == "ready":
        out["audioUrl"] = await jobs.audio_link(job)
    return out


@router.post("/plans/checkout")
async def plan_checkout(body: PlanCheckout):
    if body.plan not in PLAN_USD:
        raise HTTPException(400, "Choose one of the listed plans.")
    if body.billing not in ("monthly", "yearly"):
        raise HTTPException(400, "Billing must be monthly or yearly.")
    if body.method not in ("card", "mpesa"):
        raise HTTPException(400, "Pay by card or M-Pesa.")
    email = _clean_email(body.email)
    if not paystack.is_configured():
        return _not_configured()
    await _check_checkout_rate("voice_subscriptions", email)

    usd, kes = plan_amount(body.plan, body.billing)
    sub_id = "vs_" + secrets.token_hex(12)
    await db.insert(
        "voice_subscriptions",
        {
            "id": sub_id,
            "email": email,
            "plan": body.plan,
            "billing": body.billing,
            "method": body.method,
            "amount_kes": kes,
            "amount_usd": usd,
            "status": "pending",
        },
    )
    try:
        tx = await paystack.initialize_transaction(
            email=email,
            amount_subunits=kes * 100,
            currency="KES",
            reference=sub_id,
            callback_url=f"{settings.public_site_url}/ready",
            metadata={"purpose": "vs_plan", "subscription_id": sub_id},
            channels=["mobile_money"] if body.method == "mpesa" else ["card"],
        )
    except paystack.PaystackNotConfigured:
        return _not_configured()
    except paystack.PaystackError as exc:
        logger.warning("plan checkout %s failed to start: %s", sub_id, exc)
        raise HTTPException(502, "We could not start the payment. Please try again.")
    return {"checkoutId": sub_id, "amountKes": kes, "amountUsd": usd, "accessCode": tx.get("access_code")}


@router.get("/plans/{checkout_id}")
async def plan_status(checkout_id: str):
    if not db.is_ref_id(checkout_id) or not checkout_id.startswith("vs_"):
        raise HTTPException(404, "Checkout not found.")
    sub = await jobs.load_subscription(checkout_id)
    if not sub:
        raise HTTPException(404, "Checkout not found.")
    if sub.get("status") == "pending" and paystack.is_configured():
        sub = await jobs.refresh_subscription(sub)
    out: dict = {"checkoutId": sub["id"], "status": sub["status"], "plan": sub["plan"], "billing": sub["billing"]}
    if sub.get("period_end"):
        out["periodEnd"] = sub["period_end"]
    return out


async def _handle_charge(reference: str, data: dict) -> None:
    """Apply one charge.success; raises only on failures worth a Paystack retry."""
    metadata = data.get("metadata")
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            metadata = {}
    purpose = str(metadata.get("purpose") or "") if isinstance(metadata, dict) else ""

    if reference.startswith("vj_"):
        if purpose and purpose != "payg_job":
            logger.warning("Charge %s has purpose %r; deciding by reference", reference, purpose)
        job = await jobs.load_job(reference)
        if not job:
            logger.error("charge.success for unknown job %s", reference)
        elif not jobs.payment_matches(job, data):
            logger.error(
                "Job %s paid %s %s but quoted KES %s; not marking paid",
                reference, data.get("amount"), data.get("currency"), job.get("amount_kes"),
            )
        else:
            await jobs.mark_paid_and_generate(reference, data)
    else:
        if purpose and purpose != "vs_plan":
            logger.warning("Charge %s has purpose %r; deciding by reference", reference, purpose)
        await jobs.activate_subscription(reference, data)


@router.post("/paystack/webhook")
async def paystack_webhook(request: Request):
    raw = await request.body()
    if not paystack.verify_webhook_signature(raw, request.headers.get("x-paystack-signature")):
        raise HTTPException(401, "Invalid signature.")
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        logger.warning("Paystack webhook with unreadable body")
        return {"ok": True}
    if not isinstance(payload, dict):
        return {"ok": True}
    event = str(payload.get("event") or "")
    data = payload.get("data") or {}
    if not isinstance(data, dict):
        data = {}
    if event != "charge.success":
        return {"ok": True}
    reference = data.get("reference")
    if not isinstance(reference, str) or not db.is_ref_id(reference):
        logger.info("Ignoring charge: not a Mikaka Voice reference")
        return {"ok": True}
    event_key = f"{event}:{reference}"

    # Handle first, record after: a failure leaves no record, so Paystack's retry
    # is handled again. Repeats are safe because the status changes are atomic.
    try:
        if await db.select_one("voice_webhook_events", {"event_key": db.eq(event_key), "select": "event_key"}):
            return {"ok": True}
        await _handle_charge(reference, data)
    except Exception:  # noqa: BLE001
        logger.exception("Paystack event %s failed while handling; asking Paystack to retry", event_key)
        return JSONResponse({"ok": False}, status_code=500)
    try:
        await db.insert("voice_webhook_events", {"event_key": event_key}, ignore_duplicates=True)
    except db.DbError:
        logger.warning("Could not record Paystack event %s; a repeat is harmless", event_key)
    return {"ok": True}
