"""Server-side prices. Mirrors src/data.ts; the server's number is the one charged."""

import math

KES_PER_USD = 129.4
PAYG_USD_PER_MIN = 2.0
CHARS_PER_SECOND = 15
MAX_PAYG_CHARS = 4500
PLAN_USD = {"starter": 15, "creator": 50, "pro": 100, "business": 350}
PREMIUM_ONLY_LANGS = {"sw", "ig", "ti", "st"}

# Transcription: charged per started minute, measured by the server.
TRANSCRIBE_USD_PER_MIN = 0.10
MAX_TRANSCRIBE_SECONDS = 3 * 3600
MAX_UPLOAD_BYTES = 500 * 1024 * 1024



# String.prototype.trim() strips WhiteSpace + LineTerminator, which is not the
# same set as Python's str.strip() (JS adds U+FEFF; Python adds U+001C-U+001F, U+0085).
_JS_TRIM = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006"
    "\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def js_trim(text: str) -> str:
    return (text or "").strip(_JS_TRIM)


def js_length(text: str) -> int:
    """JS string .length: UTF-16 code units, so an emoji counts as 2."""
    return len(text.encode("utf-16-le")) // 2


def js_round(x: float) -> int:
    """Math.round: halves round up (towards +infinity), unlike Python's round()."""
    return int(math.floor(x + 0.5))


def kes_from_usd(usd: float) -> int:
    # Same operation order as the frontend: Math.ceil((usd * KES_PER_USD) / 5) * 5
    return int(math.ceil(usd * KES_PER_USD / 5) * 5)


def quote(script: str) -> dict:
    """Mirrors quoteFor in src/data.ts operation for operation.

    Projected length = chars / 15 per second × 1.1, rounded up to 30 s, 1-minute minimum.
    """
    chars = js_length(js_trim(script))
    projected = js_round(chars / CHARS_PER_SECOND)
    padded = (chars / CHARS_PER_SECOND) * 1.1
    billed = max(60, math.ceil(padded / 30) * 30)
    usd = js_round((billed / 60) * PAYG_USD_PER_MIN * 100) / 100
    return {"chars": chars, "projected_seconds": projected, "billed_seconds": billed, "usd": usd, "kes": kes_from_usd(usd)}


def transcribe_quote(seconds: float) -> dict:
    """Mirrors transcribeQuote in src/data.ts: every started minute, 1-minute minimum."""
    whole = int(math.ceil(max(0.0, seconds)))
    minutes = max(1, math.ceil(whole / 60))
    usd = js_round(minutes * TRANSCRIBE_USD_PER_MIN * 100) / 100
    return {"seconds": whole, "minutes": minutes, "usd": usd, "kes": kes_from_usd(usd)}


def plan_amount(plan: str, billing: str) -> tuple[float, int]:
    months = 10 if billing == "yearly" else 1
    usd = float(PLAN_USD[plan] * months)
    return usd, kes_from_usd(usd)
