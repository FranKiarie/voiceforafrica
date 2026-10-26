"""Public endpoints, with the database and the voice service stubbed (no network)."""

from __future__ import annotations

import importlib.util
import sys
import types

import pytest

# app/tts.py is written in parallel; stub it if it is not there yet.
if importlib.util.find_spec("app.tts") is None:
    stub = types.ModuleType("app.tts")

    class TtsError(Exception):
        def __init__(self, message: str = "", retryable: bool = False):
            super().__init__(message)
            self.retryable = retryable

    stub.TtsError = TtsError
    stub.preview_text = lambda script: script
    async def _render(text, voice_id, language, purpose=None):  # noqa: E306
        return b"ID3", 1.0
    stub.render_mp3 = _render
    sys.modules["app.tts"] = stub

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db, routes_public  # noqa: E402

SCRIPT = "Karibu Mikaka Voice. This is a short test script for a preview clip."


@pytest.fixture
def fake(monkeypatch):
    state = {"count": 0, "count_params": None, "uploads": [], "inserts": [], "selects": [], "licence": None, "jobs": [],
             "user": None, "updates": [], "deletes": [], "counts_after": None}

    async def count(table, params):
        first = state["count_params"] is None
        state["count_params"] = (table, params)
        if not first and state["counts_after"] is not None:
            return state["counts_after"]
        return state["count"] + (0 if first else len(state["inserts"]))

    async def update(table, match, patch):
        state["updates"].append((table, match, patch))
        return [patch]

    async def delete(table, match):
        state["deletes"].append((table, match))

    async def upload(path, data, content_type="audio/mpeg"):
        state["uploads"].append((path, data))

    async def insert(table, row, *, ignore_duplicates=False):
        state["inserts"].append((table, row))
        return row

    async def signed_url(path, expires_in=3600, download_name=None):
        return f"https://signed.example/{path}?e={expires_in}" + (f"&download={download_name}" if download_name else "")

    async def select_one(table, params):
        state["selects"].append((table, params))
        return state["licence"]

    async def select(table, params):
        state["selects"].append((table, params))
        return state["jobs"]

    async def user_from_token(token):
        return state["user"] if token == "good-token" else None

    async def render_mp3(text, voice_id, language, purpose=None):
        state["rendered"] = (text, voice_id, language, purpose)
        return b"ID3fake", 47.4

    for name, fn in {
        "count": count, "upload": upload, "insert": insert, "signed_url": signed_url,
        "select_one": select_one, "select": select, "user_from_token": user_from_token,
        "update": update, "delete": delete,
    }.items():
        monkeypatch.setattr(db, name, fn)
    monkeypatch.setattr(routes_public, "render_mp3", render_mp3)
    monkeypatch.setattr(routes_public, "preview_text", lambda s: s[:50])
    return state


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routes_public.router, prefix="/api/v1/voice-studio")
    return TestClient(app)


BASE = "/api/v1/voice-studio"


def test_preview_happy_path(fake, client):
    res = client.post(
        f"{BASE}/previews",
        json={"script": SCRIPT, "voiceId": "amara", "language": "sw", "email": "Ann@Example.COM"},
        headers={"Fly-Client-IP": "41.90.1.2"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["seconds"] == 47
    assert body["audioUrl"].startswith("https://signed.example/previews/")
    path = f"previews/{body['previewId']}.mp3"
    assert fake["uploads"] == [(path, b"ID3fake")]
    table, row = fake["inserts"][0]
    assert table == "voice_previews"
    assert row["email"] == "ann@example.com"
    assert row["ip"] == "41.90.1.2"
    assert row["storage_path"] == path and row["voice_id"] == "amara"
    assert len(row["script_sha256"]) == 64
    assert fake["updates"] == [("voice_previews", {"id": f"eq.{body['previewId']}"}, {"seconds": 47})]
    assert fake["deletes"] == []
    _, params = fake["count_params"]
    assert '"ann@example.com"' in params["or"] and '"41.90.1.2"' in params["or"]
    assert params["created_at"].startswith("gte.") and params["created_at"].endswith("T00:00:00Z")


def test_preview_rate_limited(fake, client):
    fake["count"] = 3
    res = client.post(
        f"{BASE}/previews",
        json={"script": SCRIPT, "voiceId": "amara", "language": "sw", "email": "ann@example.com"},
    )
    assert res.status_code == 429
    assert res.json() == {"detail": "You've used today's 3 free previews. Try again tomorrow."}
    assert fake["uploads"] == [] and fake["inserts"] == []


def test_preview_rejects_bad_input(fake, client):
    res = client.post(f"{BASE}/previews", json={"script": SCRIPT, "voiceId": "nope", "language": "sw", "email": "a@b.co"})
    assert res.status_code == 400
    res = client.post(f"{BASE}/previews", json={"script": SCRIPT, "voiceId": "amara", "language": "sw", "email": "not-an-email"})
    assert res.status_code == 400


def test_verify_not_found(fake, client):
    res = client.get(f"{BASE}/verify/vs-2026-nope00")
    assert res.status_code == 404
    assert fake["selects"][0][1]["id"] == "eq.VS-2026-NOPE00"


def test_verify_revoked_is_404(fake, client):
    fake["licence"] = {"id": "VS-2026-ABC123", "tier": "Commercial", "voice_name": "Advisor 1", "length_seconds": 45,
                       "issued_at": "2026-10-20T09:00:00+00:00", "revoked_at": "2026-10-21T00:00:00+00:00"}
    assert client.get(f"{BASE}/verify/VS-2026-ABC123").status_code == 404


def test_verify_found_without_email(fake, client):
    fake["licence"] = {"id": "VS-2026-ABC123", "tier": "Commercial", "voice_name": "Advisor 1", "length_seconds": 145,
                       "issued_at": "2026-10-20T09:00:00+00:00", "revoked_at": None,
                       "email": "secret@example.com", "paid_kes": 390}
    res = client.get(f"{BASE}/verify/vs-2026-abc123")
    assert res.status_code == 200
    assert res.json() == {"id": "VS-2026-ABC123", "tier": "Commercial", "voice": "Advisor 1",
                          "length": "2 min 25 s", "issued": "2026-10-20"}
    assert "secret@example.com" not in res.text
    assert "email" not in fake["selects"][0][1]["select"]


def test_magic_link(fake, client, monkeypatch):
    sent = {}

    async def send_magic_link(email, redirect_to):
        sent["args"] = (email, redirect_to)

    monkeypatch.setattr(db, "send_magic_link", send_magic_link)
    res = client.post(f"{BASE}/auth/magic-link", json={"email": " Ann@Example.com "})
    assert res.status_code == 204
    assert sent["args"][0] == "ann@example.com" and sent["args"][1].endswith("/clips")

    async def throttled(email, redirect_to):
        raise db.DbError("rate", 429)

    monkeypatch.setattr(db, "send_magic_link", throttled)
    res = client.post(f"{BASE}/auth/magic-link", json={"email": "ann@example.com"})
    assert res.status_code == 429
    assert res.json()["detail"] == "Too many sign-in emails. Try again in a few minutes."


def test_clips_requires_sign_in(fake, client):
    res = client.get(f"{BASE}/clips")
    assert res.status_code == 401
    assert res.json() == {"detail": "Sign in to see your clips."}
    assert client.get(f"{BASE}/clips", headers={"Authorization": "Bearer bad"}).status_code == 401


def test_clips_with_token(fake, client):
    fake["user"] = {"email": "Ann@Example.com"}
    fake["jobs"] = [{"id": "job-1", "voice_id": "sw-ke-tutor-2", "licence_id": "VS-2026-ABC123",
                     "audio_path": "clips/job-1.mp3", "audio_seconds": 45, "projected_seconds": 50,
                     "created_at": "2026-10-20T09:00:00+00:00"}]
    res = client.get(f"{BASE}/clips", headers={"Authorization": "Bearer good-token"})
    assert res.status_code == 200, res.text
    [clip] = res.json()
    assert clip["id"] == "job-1" and clip["licenceId"] == "VS-2026-ABC123"
    assert clip["voice"] == "Jabari" and clip["length"] == "45 s" and clip["tier"] == "Commercial"
    assert clip["createdAt"] == "2026-10-20T09:00:00+00:00"
    assert "e=86400" in clip["audioUrl"] and "download=" in clip["audioUrl"]
    params = fake["selects"][0][1]
    assert params["email"] == "eq.ann@example.com" and params["status"] == "eq.ready"
    assert params["order"] == "created_at.desc" and params["limit"] == "100"


def test_format_length():
    assert routes_public.format_length(45) == "45 s"
    assert routes_public.format_length(120) == "2 min"
    assert routes_public.format_length(145) == "2 min 25 s"


PREVIEW = {"script": SCRIPT, "voiceId": "amara", "language": "sw"}


def test_preview_limit_counts_email_or_ip(fake, client):
    client.post(f"{BASE}/previews", json={**PREVIEW, "email": "  ANN@Example.com "}, headers={"Fly-Client-IP": "41.90.1.2"})
    _, params = fake["count_params"]
    assert params["or"] == '(email.eq."ann@example.com",ip.eq."41.90.1.2")'


def test_preview_ignores_forged_ip_header(fake, client):
    forged = '1.2.3.4",email.neq."x'
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"}, headers={"Fly-Client-IP": forged})
    assert res.status_code == 200, res.text
    _, params = fake["count_params"]
    assert "neq" not in params["or"]
    assert fake["inserts"][0][1]["ip"] is None  # TestClient peer "testclient" is not an IP either


def test_preview_ipv6_counted_per_64(fake, client):
    client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"},
                headers={"Fly-Client-IP": "2001:db8:1:2:aaaa:bbbb:cccc:dddd"})
    assert fake["inserts"][0][1]["ip"] == "2001:db8:1:2::/64"


def test_preview_parallel_overflow_releases_reservation(fake, client):
    fake["count"] = 2
    fake["counts_after"] = 4  # another request reserved at the same time
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"})
    assert res.status_code == 429
    [(table, match)] = fake["deletes"]
    assert table == "voice_previews" and match["id"] == f"eq.{fake['inserts'][0][1]['id']}"
    assert "rendered" not in fake and fake["uploads"] == []


def test_preview_tts_failure_gives_slot_back(fake, client, monkeypatch):
    async def broken(text, voice_id, language, purpose=None):
        raise routes_public.TtsError("busy", retryable=True)

    monkeypatch.setattr(routes_public, "render_mp3", broken)
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"})
    assert res.status_code == 503
    assert len(fake["deletes"]) == 1 and fake["uploads"] == []


def test_verify_rejects_filter_syntax(fake, client):
    for bad in ["VS-2026-ABC123,id.neq.x", "VS-2026-ABC12", "abc", "VS-2026-ABC123)"]:
        assert client.get(f"{BASE}/verify/{bad}").status_code == 404
    assert fake["selects"] == []


def test_preview_passes_purpose_to_the_render(fake, client):
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com", "purpose": "radio-ad"})
    assert res.status_code == 200, res.text
    assert fake["rendered"][1:] == ("amara", "sw", "radio-ad")


def test_preview_unknown_purpose_falls_back_to_general(fake, client):
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com", "purpose": "wedding-mc"})
    assert res.status_code == 200, res.text
    assert fake["rendered"][3] == "general"


def test_preview_translates_an_old_library_voice_id(fake, client):
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "voiceId": "sw-ke-csagent-4", "email": "ann@example.com"})
    assert res.status_code == 200, res.text
    assert fake["rendered"][1] == "amara"
    assert fake["inserts"][0][1]["voice_id"] == "amara"


def test_preview_refuses_a_voice_not_offered(fake, client):
    for voice in ("sw-ke-training-7", "puck", ""):
        res = client.post(f"{BASE}/previews", json={**PREVIEW, "voiceId": voice, "email": "ann@example.com"})
        assert res.status_code == 400
