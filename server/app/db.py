"""Thin PostgREST + Storage client using the Supabase service key.

The service key bypasses row-level security, so it never leaves the server.

Filters: build every PostgREST filter value with eq() / or_eq() below, never
with a bare f-string. PostgREST reads a top-level value (`email=eq.<value>`)
verbatim, but inside a logic tree (`or=(a.eq.x,b.eq.y)`) commas, dots,
parentheses and quotes are syntax, so those values must be quoted.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote as _urlquote

import httpx

from .config import settings


class DbError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


# ---- filter helpers ---------------------------------------------------------

EMAIL_RE = re.compile(r"^[^@\s\"'(),;<>\[\]\\]+@[^@\s\"'(),;<>\[\]\\]+\.[A-Za-z]{2,}$")
REF_ID_RE = re.compile(r"^(vj|vs|vt)_[0-9a-f]{24}$")
LICENCE_ID_RE = re.compile(r"^VS-\d{4}-[A-Z0-9]{6}$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def clean_email(raw: str | None) -> str | None:
    """Stripped, lower-cased email, or None when it does not look like one."""
    email = (raw or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        return None
    return email


def is_ref_id(value: str | None) -> bool:
    return bool(value) and bool(REF_ID_RE.match(value))


def is_licence_id(value: str | None) -> bool:
    return bool(value) and bool(LICENCE_ID_RE.match(value))


def _plain(value: object) -> str:
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise ValueError("filter value must be a string or integer")
    text = str(value)
    if _CONTROL.search(text):
        raise ValueError("filter value contains control characters")
    return text


def eq(value: object) -> str:
    """Top-level equality filter: {"email": eq(email)} -> "eq.<value>" (read verbatim)."""
    return f"eq.{_plain(value)}"


def quote(value: object) -> str:
    """A value quoted for a PostgREST logic tree; backslashes and quotes escaped."""
    text = _plain(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{text}"'


def or_eq(**columns: object) -> str:
    """or=(...) over equality tests, values quoted: or_eq(email=e, ip=i) -> '(email.eq."e",ip.eq."i")'.

    None values are skipped; at least one column must remain.
    """
    parts = []
    for column, value in columns.items():
        if value is None:
            continue
        if not re.match(r"^[a-z_][a-z0-9_]*$", column):
            raise ValueError("bad column name")
        parts.append(f"{column}.eq.{quote(value)}")
    if not parts:
        raise ValueError("or_eq needs at least one value")
    return f"({','.join(parts)})"


# ---- http client ------------------------------------------------------------


def _headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    key = settings.supabase_service_key
    h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if extra:
        h.update(extra)
    return h


_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    """One shared client per process, recreated if a previous lifespan closed it."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0))
    return _client


async def aclose() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def _base() -> str:
    return settings.supabase_url.rstrip("/")


async def _send(method: str, url: str, **kwargs: Any) -> httpx.Response:
    try:
        return await _http().request(method, url, **kwargs)
    except httpx.HTTPError as exc:
        # Never include headers (they carry the service key); the type name is enough.
        raise DbError(f"{method} {url.split('?')[0]} unreachable: {type(exc).__name__}", 503) from exc


async def _req(method: str, path: str, *, params: dict | None = None, json: Any = None, prefer: str | None = None) -> Any:
    url = f"{_base()}/rest/v1/{path}"
    res = await _send(method, url, params=params, json=json, headers=_headers({"Prefer": prefer} if prefer else None))
    if res.status_code >= 400:
        raise DbError(f"{method} {path} failed: {res.status_code} {res.text[:300]}", res.status_code)
    if not res.content:
        return None
    return res.json()


async def select(table: str, params: dict[str, str]) -> list[dict]:
    """params use PostgREST syntax, e.g. {"id": eq("abc"), "select": "*", "limit": "1"}."""
    return await _req("GET", table, params=params) or []


async def select_one(table: str, params: dict[str, str]) -> dict | None:
    rows = await select(table, {**params, "limit": "1"})
    return rows[0] if rows else None


async def insert(table: str, row: dict, *, ignore_duplicates: bool = False) -> dict | None:
    prefer = "return=representation"
    if ignore_duplicates:
        prefer += ",resolution=ignore-duplicates"
    rows = await _req("POST", table, json=row, prefer=prefer)
    return rows[0] if rows else None


async def update(table: str, match: dict[str, str], patch: dict) -> list[dict]:
    """match uses PostgREST filters, e.g. {"id": eq(x), "status": "eq.paying"}. Returns updated rows."""
    if not match:
        raise ValueError("update needs a filter")
    return await _req("PATCH", table, params=match, json=patch, prefer="return=representation") or []


async def delete(table: str, match: dict[str, str]) -> None:
    if not match:
        raise ValueError("delete needs a filter")
    await _req("DELETE", table, params=match, prefer="return=minimal")


async def count(table: str, params: dict[str, str]) -> int:
    url = f"{_base()}/rest/v1/{table}"
    res = await _send("HEAD", url, params={**params, "select": "id"}, headers=_headers({"Prefer": "count=exact"}))
    if res.status_code >= 400:
        raise DbError(f"count {table} failed: {res.status_code}", res.status_code)
    total = res.headers.get("content-range", "*/0").split("/")[-1]
    try:
        return int(total)
    except ValueError as exc:
        raise DbError(f"count {table} returned no total", 502) from exc


# ---- storage --------------------------------------------------------------


def _object_path(path: str) -> str:
    return _urlquote(path.lstrip("/"), safe="/")


async def upload(path: str, data: bytes, content_type: str = "audio/mpeg") -> None:
    url = f"{_base()}/storage/v1/object/{settings.storage_bucket}/{_object_path(path)}"
    h = _headers({"Content-Type": content_type, "x-upsert": "true"})
    res = await _send("POST", url, content=data, headers=h)
    if res.status_code >= 400:
        raise DbError(f"upload {path} failed: {res.status_code} {res.text[:200]}", res.status_code)


async def download(path: str) -> bytes:
    url = f"{_base()}/storage/v1/object/{settings.storage_bucket}/{_object_path(path)}"
    res = await _send("GET", url, headers=_headers())
    if res.status_code >= 400:
        raise DbError(f"download {path} failed: {res.status_code}", res.status_code)
    return res.content


async def signed_url(path: str, expires_in: int = 3600, download_name: str | None = None) -> str:
    """Signed GET link. Supabase answers {"signedURL": "/object/sign/<bucket>/<path>?token=..."}."""
    url = f"{_base()}/storage/v1/object/sign/{settings.storage_bucket}/{_object_path(path)}"
    res = await _send("POST", url, json={"expiresIn": int(expires_in)}, headers=_headers())
    if res.status_code >= 400:
        raise DbError(f"sign {path} failed: {res.status_code}", res.status_code)
    body = res.json() if res.content else {}
    signed = (body.get("signedURL") or body.get("signedUrl") or "") if isinstance(body, dict) else ""
    if not signed:
        raise DbError(f"sign {path} returned no URL", 502)
    if signed.startswith("http://") or signed.startswith("https://"):
        full = signed
    else:
        full = f"{_base()}/storage/v1/{signed.lstrip('/')}"
    if download_name:
        full += ("&" if "?" in full else "?") + "download=" + _urlquote(download_name, safe="")
    return full


# ---- auth -----------------------------------------------------------------


async def user_from_token(access_token: str) -> dict | None:
    """Returns the Supabase auth user for a bearer token, or None if invalid."""
    res = await _send(
        "GET",
        f"{_base()}/auth/v1/user",
        headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {access_token}"},
    )
    if res.status_code != 200:
        return None
    try:
        user = res.json()
    except ValueError:
        return None
    return user if isinstance(user, dict) else None


async def send_magic_link(email: str, redirect_to: str) -> None:
    res = await _send(
        "POST",
        f"{_base()}/auth/v1/otp",
        params={"redirect_to": redirect_to},
        json={"email": email, "create_user": True},
        headers={"apikey": settings.supabase_anon_key, "Content-Type": "application/json"},
    )
    if res.status_code >= 400:
        raise DbError(f"magic link failed: {res.status_code} {res.text[:200]}", res.status_code)
