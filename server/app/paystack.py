"""
Paystack API client, borrowed from Mikaka (apps/backend/src/services/paystack.py).

Thin async wrapper over the Paystack REST API plus webhook signature
verification. All amounts are integer subunits (kobo / KES cents) in the
account currency, matching the billing schema convention.

The secret key is read from settings (PAYSTACK_SECRET_KEY). Webhooks are
authenticated by recomputing HMAC-SHA512 of the raw body with the secret key
and comparing against the x-paystack-signature header.
"""

import hashlib
import hmac
import logging
from typing import Any, Dict, List, Optional

import httpx

from .config import settings

logger = logging.getLogger(__name__)

PAYSTACK_BASE_URL = "https://api.paystack.co"


class PaystackError(Exception):
    """Raised when Paystack returns a failure response."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class PaystackNotConfigured(PaystackError):
    """Raised when no PAYSTACK_SECRET_KEY is configured."""

    def __init__(self):
        super().__init__("Paystack is not configured (PAYSTACK_SECRET_KEY missing)", 503)


def _secret_key() -> str:
    key = (settings.paystack_secret_key or "").strip()
    if not key:
        raise PaystackNotConfigured()
    return key


def is_configured() -> bool:
    return bool((settings.paystack_secret_key or "").strip())


def verify_webhook_signature(raw_body: bytes, signature: Optional[str]) -> bool:
    """Validate the x-paystack-signature header against the raw request body."""
    if not signature or not is_configured():
        return False
    expected = hmac.new(
        _secret_key().encode("utf-8"), raw_body, hashlib.sha512
    ).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


async def _request(method: str, path: str, json: Optional[Dict[str, Any]] = None, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    headers = {
        "Authorization": f"Bearer {_secret_key()}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(base_url=PAYSTACK_BASE_URL, timeout=30.0) as client:
        response = await client.request(method, path, json=json, params=params, headers=headers)
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    if response.status_code >= 400 or not payload.get("status", False):
        message = str(payload.get("message") or f"Paystack request failed ({response.status_code})")
        logger.warning("Paystack %s %s failed: %s", method, path, message)
        raise PaystackError(message, response.status_code)
    return payload.get("data") or {}


async def initialize_transaction(
    *,
    email: str,
    amount_subunits: int,
    currency: str = "KES",
    reference: Optional[str] = None,
    callback_url: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    plan_code: Optional[str] = None,
    channels: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Start a checkout; returns authorization_url, access_code, reference."""
    body: Dict[str, Any] = {
        "email": email,
        "amount": int(amount_subunits),
        "currency": currency,
    }
    if reference:
        body["reference"] = reference
    if callback_url:
        body["callback_url"] = callback_url
    if metadata:
        body["metadata"] = metadata
    if plan_code:
        body["plan"] = plan_code
    if channels:
        body["channels"] = channels
    return await _request("POST", "/transaction/initialize", json=body)


async def verify_transaction(reference: str) -> Dict[str, Any]:
    """Fetch the authoritative status of a transaction by reference."""
    safe_ref = str(reference).strip()
    if not safe_ref:
        raise PaystackError("Transaction reference required", 400)
    return await _request("GET", f"/transaction/verify/{safe_ref}")


async def disable_subscription(subscription_code: str, email_token: str) -> Dict[str, Any]:
    return await _request(
        "POST",
        "/subscription/disable",
        json={"code": subscription_code, "token": email_token},
    )


async def fetch_subscription(subscription_code: str) -> Dict[str, Any]:
    return await _request("GET", f"/subscription/{subscription_code}")
