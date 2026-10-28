"""Public endpoints: free previews, licence checks, sign-in links, the clip list and the account summary.

Email rule for every module: emails are lower-cased (and stripped) before they are
stored or compared, so "Ann@X.com" and "ann@x.com" are the same customer.
"""

from __future__ import annotations

import asyncio
import logging
import hashlib
import ipaddress
import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel

from . import db, renders
from .config import settings
from .catalog import public_voice_id, purpose_or_default, voice_name
from .pricing import MAX_PAYG_CHARS
from .tts import TtsError, preview_text, render_mp3

logger = logging.getLogger(__name__)

router = APIRouter()

EMAIL_RE = db.EMAIL_RE
LANG_RE = re.compile(r"^[a-z]{2,3}$")
MIN_SCRIPT_CHARS = 20
# A preview is one short chunk; do not hold the request open through every retry.
PREVIEW_RENDER_SECONDS = 120


# ---- helpers --------------------------------------------------------------


def normalise_email(raw: str) -> str:
    """Lower-cases and validates an email; raises 400 when it does not look like one."""
    email = db.clean_email(raw)
    if email is None:
        raise HTTPException(400, "Please enter a valid email address.")
    return email


def format_length(seconds: int | float | None) -> str:
    """Mirrors formatDuration in src/data.ts: "45 s", "2 min", "2 min 25 s"."""
    total = max(0, int(round(seconds or 0)))
    m, s = divmod(total, 60)
    if m == 0:
        return f"{s} s"
    return f"{m} min" if s == 0 else f"{m} min {s} s"


def _ip_key(raw: str | None) -> str | None:
    """Canonical rate-limit key for an address, or None when it is not an IP.

    IPv6 is counted per /64, since one subscriber normally holds a whole /64.
    """
    try:
        addr = ipaddress.ip_address((raw or "").strip())
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped:
            return str(addr.ipv4_mapped)
        return str(ipaddress.ip_network(f"{addr}/64", strict=False))
    return str(addr)


def client_ip(request: Request) -> str | None:
    """The caller's address as our host's edge saw it; anything that is not a plain IP is ignored.

    Fly's edge sets Fly-Client-IP. Cloud Run passes a caller's own X-Forwarded-For
    through and appends the address it saw, so there the address is counted from
    the right and Fly-Client-IP is ignored, since any caller could send it.
    """
    hops = settings.forwarded_for_hops
    if hops > 0:
        raw = ",".join(request.headers.getlist("x-forwarded-for"))
        hosts = [h.strip() for h in raw.split(",") if h.strip()]
        return _ip_key(hosts[-hops]) if len(hosts) >= hops else None
    key = _ip_key(request.headers.get("fly-client-ip"))
    if key:
        return key
    return _ip_key(request.client.host if request.client else None)


def _utc_stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _midnight_utc() -> str:
    now = datetime.now(timezone.utc)
    return _utc_stamp(now.replace(hour=0, minute=0, second=0, microsecond=0))


def _today_filter(email: str, ip: str | None) -> dict[str, str]:
    """Previews since midnight UTC for this email OR this IP."""
    return {"or": db.or_eq(email=email, ip=ip), "created_at": f"gte.{_midnight_utc()}"}


async def _drop_reservation(preview_id: str) -> None:
    try:
        await db.delete("voice_previews", {"id": db.eq(preview_id)})
    except db.DbError:
        pass


# ---- previews -------------------------------------------------------------


class PreviewIn(BaseModel):
    script: str = ""
    voiceId: str = ""
    language: str = ""
    email: str = ""
    purpose: str = ""


@router.post("/previews")
async def create_preview(body: PreviewIn, request: Request) -> dict:
    script = (body.script or "").strip()
    if len(script) < MIN_SCRIPT_CHARS:
        raise HTTPException(400, f"Your script needs at least {MIN_SCRIPT_CHARS} characters.")
    if len(script) > MAX_PAYG_CHARS:
        raise HTTPException(400, f"Your script is longer than {MAX_PAYG_CHARS:,} characters.")
    voice_id = public_voice_id(body.voiceId)
    if not voice_id:
        raise HTTPException(400, "Please choose one of the listed voices.")
    purpose = purpose_or_default(body.purpose)
    language = (body.language or "").strip().lower()
    if not LANG_RE.match(language):
        raise HTTPException(400, "Please choose a language.")
    email = normalise_email(body.email)

    # The same opening in the same voice and style was made before: reuse it.
    # A cached preview costs nothing, so it does not use a free preview.
    text = preview_text(script)
    key = renders.cache_key(text, voice_id, language, purpose)
    cached = await renders.find(key)
    if cached:
        try:
            audio_url = await db.signed_url(cached["storage_path"], 3600)
            return {"previewId": str(uuid.uuid4()), "seconds": int(cached["seconds"]), "audioUrl": audio_url}
        except db.DbError:
            logger.warning("Cached preview %s could not be signed; rendering afresh", key[:12])

    ip = client_ip(request)
    limit = settings.previews_per_day
    limited = HTTPException(429, f"You've used today's {limit} free previews. Try again tomorrow.")

    try:
        if await db.count("voice_previews", _today_filter(email, ip)) >= limit:
            raise limited
        # Reserve the slot before rendering, then recount, so parallel requests
        # cannot all pass the check above and each get a free render.
        preview_id = str(uuid.uuid4())
        path = renders.cache_path(key)
        await db.insert(
            "voice_previews",
            {
                "id": preview_id,
                "email": email,
                "ip": ip,
                "voice_id": voice_id,
                "language": language,
                "script_sha256": hashlib.sha256(script.encode("utf-8")).hexdigest(),
                "seconds": 0,
                "storage_path": path,
            },
        )
    except db.DbError as e:
        raise HTTPException(503, "Previews are unavailable right now. Please try again.") from e
    try:
        over = await db.count("voice_previews", _today_filter(email, ip)) > limit
    except db.DbError:
        over = True
    if over:
        await _drop_reservation(preview_id)
        raise limited

    try:
        mp3, seconds = await asyncio.wait_for(render_mp3(text, voice_id, language, purpose), PREVIEW_RENDER_SECONDS)
    except (TimeoutError, asyncio.TimeoutError) as e:
        await _drop_reservation(preview_id)
        raise HTTPException(503, "The voice service is busy. Please try again in a minute.") from e
    except TtsError as e:
        await _drop_reservation(preview_id)
        logger.warning("Preview render failed for voice %s: %s", voice_id, e)
        if "per day" in str(e):
            raise HTTPException(
                503, "We've reached today's limit for new voice clips. Please try again in a few hours."
            ) from e
        if getattr(e, "retryable", False):
            raise HTTPException(503, "The voice service is busy. Please try again in a minute.") from e
        raise HTTPException(503, "The voice service isn't switched on yet.") from e

    seconds = int(round(seconds))
    try:
        await db.upload(path, mp3)
        await db.update("voice_previews", {"id": db.eq(preview_id)}, {"seconds": seconds})
        audio_url = await db.signed_url(path, 3600)
    except db.DbError as e:
        await _drop_reservation(preview_id)
        raise HTTPException(502, "We couldn't save your preview. Please try again.") from e
    await renders.remember(key, seconds, voice_id=voice_id, language=language, purpose=purpose, chars=len(text))
    return {"previewId": preview_id, "seconds": seconds, "audioUrl": audio_url}


# ---- licence check --------------------------------------------------------


@router.get("/verify/{licence_id}")
async def verify_licence(licence_id: str) -> dict:
    lid = (licence_id or "").strip().upper()
    if not db.is_licence_id(lid):
        raise HTTPException(404, "Licence not found.")
    try:
        row = await db.select_one(
            "voice_licences",
            {"id": db.eq(lid), "select": "id,tier,voice_name,length_seconds,issued_at,revoked_at"},
        )
    except db.DbError as e:
        raise HTTPException(503, "Licence checks are unavailable right now. Please try again.") from e
    if not row or row.get("revoked_at"):
        raise HTTPException(404, "Licence not found.")
    # Public endpoint: never return the buyer's email or what they paid.
    return {
        "id": row["id"],
        "tier": row.get("tier") or "Commercial",
        "voice": row.get("voice_name") or "",
        "length": format_length(row.get("length_seconds")),
        "issued": str(row.get("issued_at") or "")[:10],
    }


# ---- sign-in --------------------------------------------------------------


class MagicLinkIn(BaseModel):
    email: str = ""


@router.post("/auth/magic-link", status_code=204)
async def magic_link(body: MagicLinkIn) -> Response:
    email = normalise_email(body.email)
    try:
        await db.send_magic_link(email, redirect_to=f"{settings.public_site_url.rstrip('/')}/dashboard")
    except db.DbError as e:
        if e.status_code == 429:
            raise HTTPException(429, "Too many sign-in emails. Try again in a few minutes.") from e
        raise HTTPException(502, "We couldn't send the sign-in email. Please try again.") from e
    return Response(status_code=204)


# ---- signed-in customer ----------------------------------------------------


async def _signed_in_email(authorization: str | None, message: str) -> str:
    """Lower-cased email of the Supabase user behind `Authorization: Bearer <token>`.

    Raises 401 with `message` when there is no usable signed-in user, and 503 when
    Supabase auth cannot be reached. The email is safe to pass to db.eq().
    """
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    try:
        user = await db.user_from_token(token) if token else None
    except db.DbError as e:
        raise HTTPException(503, "Sign-in is unavailable right now. Please try again.") from e
    if not user or not user.get("email"):
        raise HTTPException(401, message)
    email = str(user["email"]).strip().lower()
    try:
        db.eq(email)
    except ValueError as e:
        raise HTTPException(401, message) from e
    return email


def _row_kes(rows: list[dict]) -> int:
    return sum(int(r.get("amount_kes") or 0) for r in rows)


def _row_usd(rows: list[dict]) -> float:
    return sum(float(r.get("amount_usd") or 0) for r in rows)


# ---- clips ----------------------------------------------------------------


@router.get("/clips")
async def list_clips(authorization: str | None = Header(default=None)) -> list[dict]:
    email = await _signed_in_email(authorization, "Sign in to see your clips.")
    try:
        jobs = await db.select(
            "voice_jobs",
            {
                "email": db.eq(email),
                "status": "eq.ready",
                "select": "id,voice_id,licence_id,audio_path,audio_seconds,projected_seconds,created_at",
                "order": "created_at.desc",
                "limit": "100",
            },
        )
    except db.DbError as e:
        raise HTTPException(503, "Your clips are unavailable right now. Please try again.") from e

    async def link(j: dict) -> str | None:
        if not j.get("audio_path"):
            return None
        name = f"mikaka-voice-{j.get('licence_id') or j['id']}.mp3"
        try:
            return await db.signed_url(j["audio_path"], 86400, download_name=name)
        except db.DbError:
            return None

    links = await asyncio.gather(*(link(j) for j in jobs))
    clips: list[dict] = []
    for j, audio_url in zip(jobs, links):
        seconds = max(0, int(round(j.get("audio_seconds") or j.get("projected_seconds") or 0)))
        clip = {
            "id": j["id"],
            "licenceId": j.get("licence_id") or "",
            "voice": voice_name(j.get("voice_id") or ""),
            "length": format_length(seconds),
            "seconds": seconds,
            "createdAt": j.get("created_at") or "",
            "tier": "Commercial",
        }
        if audio_url:
            clip["audioUrl"] = audio_url
        clips.append(clip)
    return clips


# ---- account --------------------------------------------------------------

# Spend is summed here over plain rows of amount_kes; 1,000 paid clips or plan
# payments per customer is far past anyone today.
ACCOUNT_ROW_LIMIT = "1000"


@router.get("/account")
async def account(request: Request, authorization: str | None = Header(default=None)) -> dict:
    email = await _signed_in_email(authorization, "Sign in to see your account.")
    email_filter = db.eq(email)
    limit = settings.previews_per_day

    plan_row, jobs, subs, used = await asyncio.gather(
        db.select_one(
            "voice_subscriptions",
            {
                "email": email_filter,
                "status": "eq.active",
                "period_end": f"gt.{_utc_stamp(datetime.now(timezone.utc))}",
                "select": "plan,billing,period_end",
                "order": "created_at.desc",
            },
        ),
        db.select(
            "voice_jobs",
            {"email": email_filter, "status": "eq.ready", "select": "amount_kes,amount_usd", "limit": ACCOUNT_ROW_LIMIT},
        ),
        db.select(
            "voice_subscriptions",
            {
                "email": email_filter,
                "status": "in.(active,expired)",
                "select": "amount_kes,amount_usd",
                "limit": ACCOUNT_ROW_LIMIT,
            },
        ),
        db.count("voice_previews", _today_filter(email, client_ip(request))),
        return_exceptions=True,
    )
    for result in (plan_row, jobs, subs, used):
        if isinstance(result, BaseException) and not isinstance(result, db.DbError):
            raise result
    for result in (plan_row, jobs, subs):
        if isinstance(result, db.DbError):
            raise HTTPException(503, "Your account is unavailable right now. Please try again.") from result

    plan = None
    if plan_row:
        plan = {"plan": plan_row.get("plan"), "billing": plan_row.get("billing"), "periodEnd": plan_row.get("period_end")}
    # The preview limit is enforced again when a preview is asked for, so a
    # failed count only means the number shown may be optimistic.
    previews_left = limit if isinstance(used, db.DbError) else max(0, limit - int(used))
    return {
        "email": email,
        "plan": plan,
        "previewsLeft": previews_left,
        "previewsPerDay": limit,
        "spentKes": _row_kes(jobs) + _row_kes(subs),
        # Prices are shown in dollars; the stored dollar price avoids converting rounded shillings back.
        "spentUsd": round(_row_usd(jobs) + _row_usd(subs), 2),
    }
