"""Customers' audio for transcription, in a private Cloud Storage bucket.

Files can be up to 500 MB, far above Cloud Run's 32 MB request limit and the
Supabase free plan's 50 MB file limit, so the browser PUTs them straight to the
bucket with a short-lived signed URL. The server reads them back through
another signed URL (ffmpeg streams it) and deletes them once the transcript is
stored; a bucket rule deletes anything left after a day.

The PUT is signed with two headers the browser must send: a size range (so a
URL cannot be used to park gigabytes) and if-generation-match 0 (so the object
can be written once and never swapped after it was priced). The quote records
the object's generation, and the transcription reads exactly that generation.

Signing uses the runtime service account through IAM signBlob, so it needs
roles/iam.serviceAccountTokenCreator on itself. The calls block, so they run in
a worker thread.
"""

from __future__ import annotations

import asyncio
from datetime import timedelta

from .config import settings
from .pricing import MAX_UPLOAD_BYTES

UPLOAD_URL_MINUTES = 60
READ_URL_HOURS = 6

_client = None


def _bucket():
    global _client
    if _client is None:
        from google.cloud import storage

        _client = storage.Client()
    return _client.bucket(settings.upload_bucket)


def _signing() -> dict:
    import google.auth
    from google.auth.transport.requests import Request

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(Request())
    return {"service_account_email": creds.service_account_email, "access_token": creds.token}


def upload_headers(content_type: str) -> dict[str, str]:
    """Headers the browser must send with the PUT, exactly as signed."""
    return {
        "Content-Type": content_type,
        "x-goog-content-length-range": f"0,{MAX_UPLOAD_BYTES}",
        "x-goog-if-generation-match": "0",
    }


async def upload_url(path: str, content_type: str) -> tuple[str, dict[str, str]]:
    """A signed, write-once PUT URL and the headers that must go with it."""
    headers = upload_headers(content_type)

    def make() -> str:
        return _bucket().blob(path).generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=UPLOAD_URL_MINUTES),
            method="PUT",
            content_type=content_type,
            headers={k: v for k, v in headers.items() if k != "Content-Type"},
            **_signing(),
        )

    return await asyncio.to_thread(make), headers


async def read_url(path: str, generation: int | None = None) -> str:
    """A signed GET URL; with a generation, only that exact upload can be read."""

    def make() -> str:
        return _bucket().blob(path, generation=generation).generate_signed_url(
            version="v4", expiration=timedelta(hours=READ_URL_HOURS), method="GET", **_signing()
        )

    return await asyncio.to_thread(make)


async def stat(path: str) -> tuple[int, int] | None:
    """(bytes, generation) of the object at path, or None when nothing was uploaded."""

    def get() -> tuple[int, int] | None:
        blob = _bucket().get_blob(path)
        return None if blob is None else (int(blob.size or 0), int(blob.generation or 0))

    return await asyncio.to_thread(get)


async def delete(path: str) -> None:
    def drop() -> None:
        blob = _bucket().blob(path)
        try:
            blob.delete()
        except Exception as exc:  # noqa: BLE001 - already gone is fine
            if getattr(exc, "code", None) != 404:
                raise

    await asyncio.to_thread(drop)
