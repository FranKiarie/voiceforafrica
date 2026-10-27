"""db.py filter helpers, storage links and client lifecycle; pricing parity with src/data.ts."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app import db, pricing


def test_eq_is_verbatim_and_rejects_control_chars():
    assert db.eq("ann@example.com") == "eq.ann@example.com"
    assert db.eq(5) == "eq.5"
    for bad in ["a\nb", "a\x00", None, True, 1.5]:
        with pytest.raises(ValueError):
            db.eq(bad)


def test_or_eq_quotes_logic_tree_values():
    assert db.or_eq(email="a.b@x.co", ip=None) == '(email.eq."a.b@x.co")'
    assert db.or_eq(email='x",id.neq.(1)', ip="1.2.3.4") == '(email.eq."x\\",id.neq.(1)",ip.eq."1.2.3.4")'
    assert db.quote("a\\b") == '"a\\\\b"'
    with pytest.raises(ValueError):
        db.or_eq(email=None)
    with pytest.raises(ValueError):
        db.or_eq(**{"email,or": "x"})


def test_validators():
    assert db.clean_email("  Ann@Example.COM ") == "ann@example.com"
    for bad in ["a,b@x.co", "a(b)@x.co", 'a"b@x.co', "a@b", "", "a b@x.co"]:
        assert db.clean_email(bad) is None
    assert db.is_ref_id("vj_" + "a" * 24) and db.is_ref_id("vs_" + "0" * 24)
    assert not db.is_ref_id("vj_" + "A" * 24) and not db.is_ref_id("vj_abc,id.neq.1")
    assert db.is_licence_id("VS-2026-ABC123")
    assert not db.is_licence_id("VS-2026-ABC123,") and not db.is_licence_id("vs-2026-abc123")


@pytest.fixture
def mock_http(monkeypatch):
    seen: list[httpx.Request] = []
    responses: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return responses["fn"](request)

    monkeypatch.setattr(db.settings, "supabase_url", "https://proj.supabase.co/")
    monkeypatch.setattr(db.settings, "supabase_service_key", "service-key")
    monkeypatch.setattr(db, "_client", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return seen, responses


def test_signed_url_format_and_encoded_download_name(mock_http):
    seen, responses = mock_http
    responses["fn"] = lambda r: httpx.Response(
        200, json={"signedURL": "/object/sign/voice-audio/clips/vj_1.mp3?token=abc"})
    url = asyncio.run(db.signed_url("clips/vj_1.mp3", 60, download_name="mikaka voice&x=1.mp3"))
    assert url == ("https://proj.supabase.co/storage/v1/object/sign/voice-audio/clips/vj_1.mp3"
                   "?token=abc&download=mikaka%20voice%26x%3D1.mp3")
    assert str(seen[0].url) == "https://proj.supabase.co/storage/v1/object/sign/voice-audio/clips/vj_1.mp3"
    assert json.loads(seen[0].content) == {"expiresIn": 60}


def test_signed_url_without_url_is_error(mock_http):
    _, responses = mock_http
    responses["fn"] = lambda r: httpx.Response(200, json={})
    with pytest.raises(db.DbError):
        asyncio.run(db.signed_url("clips/x.mp3"))


def test_count_reads_content_range(mock_http):
    seen, responses = mock_http
    responses["fn"] = lambda r: httpx.Response(200, headers={"content-range": "0-1/2"})
    assert asyncio.run(db.count("voice_previews", {"or": db.or_eq(email="a@b.co")})) == 2
    assert seen[0].method == "HEAD" and seen[0].headers["prefer"] == "count=exact"


def test_network_error_becomes_dberror_without_key(mock_http):
    _, responses = mock_http

    def boom(request):
        raise httpx.ConnectError("down", request=request)

    responses["fn"] = boom
    with pytest.raises(db.DbError) as err:
        asyncio.run(db.select("voice_jobs", {"id": db.eq("x")}))
    assert err.value.status_code == 503 and "service-key" not in str(err.value)


def test_client_recreated_after_close():
    asyncio.run(db.aclose())
    first = db._http()
    asyncio.run(db.aclose())
    assert first.is_closed and db._http() is not first


# pricing.quote must equal quoteFor in src/data.ts (values computed with node).

@pytest.mark.parametrize("script,expected", [
    ("a" * 20, (20, 1, 60, 2.0, 260)),
    ("a" * 832, (832, 55, 90, 3.0, 390)),
    ("a" * 4500, (4500, 300, 330, 11.0, 1425)),
    ("  ﻿" + "b" * 100 + "  ", (100, 7, 60, 2.0, 260)),
    ("😀" * 400, (800, 53, 60, 2.0, 260)),
])
def test_quote_matches_frontend(script, expected):
    q = pricing.quote(script)
    assert (q["chars"], q["projected_seconds"], q["billed_seconds"], q["usd"], q["kes"]) == expected
