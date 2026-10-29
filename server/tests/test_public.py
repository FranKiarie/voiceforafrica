"""Public endpoints, with the database and the voice service stubbed (no network)."""

from __future__ import annotations

import importlib.util
import sys
import types
from datetime import datetime, timedelta, timezone

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
    stub.pick_model = lambda language: "gemini-3.8-flash-tts"
    stub.preview_text = getattr(stub, "preview_text", lambda script: script)
    sys.modules["app.tts"] = stub

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import db, routes_public  # noqa: E402

SCRIPT = "Karibu Mikaka Voice. This is a short test script for a preview clip."


@pytest.fixture
def fake(monkeypatch):
    state = {"count": 0, "count_params": None, "uploads": [], "inserts": [], "selects": [], "licence": None, "jobs": [],
             "user": None, "updates": [], "deletes": [], "counts_after": None,
             # Rows per table, filtered like PostgREST would; tables not listed keep the old behaviour.
             "tables": {}}

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
        if table in state["tables"]:
            rows = await select(table, {**params, "limit": "1"})
            return rows[0] if rows else None
        state["selects"].append((table, params))
        return state["licence"]

    async def select(table, params):
        state["selects"].append((table, params))
        if table in state["tables"]:
            return _postgrest(state["tables"][table], params)
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
    async def for_language(script, language):
        state["translated"] = (script, language)
        return script, False

    monkeypatch.setattr(routes_public, "render_mp3", render_mp3)
    monkeypatch.setattr(routes_public, "preview_text", lambda s: s[:50])
    monkeypatch.setattr(routes_public.translate, "for_language", for_language)
    return state


def _postgrest(rows, params):
    """Just enough PostgREST for these tests: eq./in./gt. filters, order, limit and select."""
    out = []
    for row in rows:
        keep = True
        for col, rule in params.items():
            if col in ("select", "order", "limit"):
                continue
            op, _, arg = rule.partition(".")
            value = row.get(col)
            if op == "eq":
                keep = str(value) == arg
            elif op == "in":
                keep = str(value) in arg.strip("()").split(",")
            elif op == "gt":
                keep = value is not None and datetime.fromisoformat(value) > datetime.fromisoformat(arg)
            else:
                raise AssertionError(f"fake PostgREST does not know {rule!r}")
            if not keep:
                break
        if keep:
            out.append(row)
    if params.get("order"):
        col, _, direction = params["order"].partition(".")
        out.sort(key=lambda r: r[col], reverse=direction == "desc")
    if params.get("limit"):
        out = out[: int(params["limit"])]
    if params.get("select") and params["select"] != "*":
        cols = params["select"].split(",")
        out = [{c: r.get(c) for c in cols} for r in out]
    return out


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routes_public.router, prefix="/api/v1/voice-studio")
    return TestClient(app)


BASE = "/api/v1/voice-studio"


def test_preview_happy_path(fake, client):
    res = client.post(
        f"{BASE}/previews",
        json={"script": SCRIPT, "voiceId": "wanjiru", "language": "sw", "email": "Ann@Example.COM"},
        headers={"Fly-Client-IP": "41.90.1.2"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["seconds"] == 47
    assert body["audioUrl"].startswith("https://signed.example/renders/")
    path = fake["uploads"][0][0]
    assert path.startswith("renders/") and path.endswith(".mp3")
    assert fake["uploads"] == [(path, b"ID3fake")]
    table, row = fake["inserts"][0]
    assert table == "voice_previews"
    assert row["email"] == "ann@example.com"
    assert row["ip"] == "41.90.1.2"
    assert row["storage_path"] == path and row["voice_id"] == "wanjiru"
    assert len(row["script_sha256"]) == 64
    assert fake["updates"] == [("voice_previews", {"id": f"eq.{body['previewId']}"}, {"seconds": 47})]
    assert fake["deletes"] == []
    _, params = fake["count_params"]
    assert '"ann@example.com"' in params["or"] and '"41.90.1.2"' in params["or"]
    assert params["created_at"].startswith("gte.") and params["created_at"].endswith("T00:00:00Z")
    # The render is remembered so the same opening is never made twice.
    cached = [r for t, r in fake["inserts"] if t == "voice_renders"]
    assert cached and cached[0]["storage_path"] == path and cached[0]["seconds"] == 47


def test_preview_rate_limited(fake, client):
    fake["count"] = 3
    res = client.post(
        f"{BASE}/previews",
        json={"script": SCRIPT, "voiceId": "wanjiru", "language": "sw", "email": "ann@example.com"},
    )
    assert res.status_code == 429
    assert res.json() == {"detail": "You've used today's 3 free previews. Try again tomorrow."}
    assert fake["uploads"] == [] and fake["inserts"] == []


def test_preview_rejects_bad_input(fake, client):
    res = client.post(f"{BASE}/previews", json={"script": SCRIPT, "voiceId": "nope", "language": "sw", "email": "a@b.co"})
    assert res.status_code == 400
    res = client.post(f"{BASE}/previews", json={"script": SCRIPT, "voiceId": "wanjiru", "language": "sw", "email": "not-an-email"})
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
    assert sent["args"][0] == "ann@example.com" and sent["args"][1].endswith("/dashboard")

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
    assert clip["seconds"] == 45
    assert "e=86400" in clip["audioUrl"] and "download=" in clip["audioUrl"]
    params = fake["selects"][0][1]
    assert params["email"] == "eq.ann@example.com" and params["status"] == "eq.ready"
    assert params["order"] == "created_at.desc" and params["limit"] == "100"


def test_format_length():
    assert routes_public.format_length(45) == "45 s"
    assert routes_public.format_length(120) == "2 min"
    assert routes_public.format_length(145) == "2 min 25 s"


PREVIEW = {"script": SCRIPT, "voiceId": "wanjiru", "language": "sw"}


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


def test_preview_ip_counted_from_right_of_forwarded_for(fake, client, monkeypatch):
    monkeypatch.setattr(routes_public.settings, "forwarded_for_hops", 1)
    client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"},
                headers={"X-Forwarded-For": "9.9.9.9, 41.90.1.2", "Fly-Client-IP": "8.8.8.8"})
    assert fake["inserts"][0][1]["ip"] == "41.90.1.2"


def test_preview_without_forwarded_for_has_no_ip(fake, client, monkeypatch):
    monkeypatch.setattr(routes_public.settings, "forwarded_for_hops", 1)
    client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"}, headers={"Fly-Client-IP": "8.8.8.8"})
    assert fake["inserts"][0][1]["ip"] is None


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
    assert fake["rendered"][1:] == ("wanjiru", "sw", "radio-ad")


def test_preview_unknown_purpose_falls_back_to_general(fake, client):
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com", "purpose": "wedding-mc"})
    assert res.status_code == 200, res.text
    assert fake["rendered"][3] == "general"


def test_preview_translates_an_old_library_voice_id(fake, client):
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "voiceId": "sw-ke-csagent-4", "email": "ann@example.com"})
    assert res.status_code == 200, res.text
    assert fake["rendered"][1] == "wanjiru"
    assert fake["inserts"][0][1]["voice_id"] == "wanjiru"


def test_preview_refuses_a_voice_not_offered(fake, client):
    for voice in ("sw-ke-training-7", "puck", ""):
        res = client.post(f"{BASE}/previews", json={**PREVIEW, "voiceId": voice, "email": "ann@example.com"})
        assert res.status_code == 400


def test_preview_translates_a_renamed_voice(fake, client):
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "voiceId": "amara", "email": "ann@example.com"})
    assert res.status_code == 200, res.text
    assert fake["rendered"][1] == "wanjiru"


def test_preview_says_when_the_daily_voice_limit_is_reached(fake, client, monkeypatch):
    async def capped(text, voice_id, language, purpose=None):
        raise routes_public.TtsError("Gemini speech request failed (429): limit: 10 requests per day", retryable=True)

    monkeypatch.setattr(routes_public, "render_mp3", capped)
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"})
    assert res.status_code == 503
    assert "today's limit" in res.json()["detail"]
    assert len(fake["deletes"]) == 1


def test_clips_still_says_sign_in_to_see_your_clips(fake, client):
    # Same text for no token, a bad token, a user without an email and an unusable email.
    for headers, user in [({}, None), ({"Authorization": "Bearer bad"}, None),
                          ({"Authorization": "Bearer good-token"}, {"id": "u1"}),
                          ({"Authorization": "Bearer good-token"}, {"email": "ann\x00@example.com"})]:
        fake["user"] = user
        res = client.get(f"{BASE}/clips", headers=headers)
        assert res.status_code == 401
        assert res.json() == {"detail": "Sign in to see your clips."}
    assert fake["selects"] == []


def test_clips_sign_in_outage_is_503(fake, client, monkeypatch):
    async def down(token):
        raise db.DbError("auth down", 503)

    monkeypatch.setattr(db, "user_from_token", down)
    res = client.get(f"{BASE}/clips", headers={"Authorization": "Bearer good-token"})
    assert res.status_code == 503
    assert res.json() == {"detail": "Sign-in is unavailable right now. Please try again."}


def test_clips_seconds_falls_back_to_projected_then_zero(fake, client):
    fake["user"] = {"email": "ann@example.com"}
    fake["jobs"] = [
        {"id": "job-1", "voice_id": "wanjiru", "audio_seconds": None, "projected_seconds": 130, "created_at": "x"},
        {"id": "job-2", "voice_id": "wanjiru", "audio_seconds": None, "projected_seconds": None, "created_at": "x"},
    ]
    res = client.get(f"{BASE}/clips", headers={"Authorization": "Bearer good-token"})
    assert res.status_code == 200, res.text
    first, second = res.json()
    assert first["seconds"] == 130 and first["length"] == "2 min 10 s"
    assert second["seconds"] == 0 and second["length"] == "0 s"
    assert set(first) == {"id", "licenceId", "voice", "length", "seconds", "createdAt", "tier", "versions"}
    assert [v["id"] for v in first["versions"] if v["allowed"]] == ["mp3"]  # no plan: MP3 only


# ---- account --------------------------------------------------------------

AUTH = {"Authorization": "Bearer good-token"}


def _iso(days: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _sub(sub_id, plan, status, period_end, amount_kes, created_days_ago, email="ann@example.com", billing="monthly",
         amount_usd=None):
    return {"id": sub_id, "email": email, "plan": plan, "billing": billing, "status": status,
            "period_start": _iso(-created_days_ago), "period_end": period_end, "amount_kes": amount_kes,
            "amount_usd": amount_usd, "created_at": _iso(-created_days_ago)}


def _job(job_id, status, amount_kes, email="ann@example.com", amount_usd=None):
    return {"id": job_id, "email": email, "status": status, "amount_kes": amount_kes, "amount_usd": amount_usd,
            "created_at": _iso(-1)}


@pytest.fixture
def ann(fake):
    fake["user"] = {"email": "Ann@Example.com"}
    fake["tables"] = {"voice_subscriptions": [], "voice_jobs": []}
    return fake


def test_account_requires_sign_in(fake, client):
    res = client.get(f"{BASE}/account")
    assert res.status_code == 401
    assert res.json() == {"detail": "Sign in to see your account."}
    res = client.get(f"{BASE}/account", headers={"Authorization": "Bearer bad"})
    assert res.status_code == 401
    assert res.json() == {"detail": "Sign in to see your account."}
    assert fake["selects"] == [] and fake["count_params"] is None


def test_account_with_an_active_plan(ann, client):
    period_end = _iso(20)
    ann["tables"]["voice_subscriptions"] = [
        _sub("vs_old", "starter", "expired", _iso(-10), 300, 40),
        _sub("vs_now", "creator", "active", period_end, 1500, 10),
        _sub("vs_try", "pro", "pending", None, 4000, 0),
    ]
    ann["count"] = 1
    res = client.get(f"{BASE}/account", headers={**AUTH, "Fly-Client-IP": "41.90.1.2"})
    assert res.status_code == 200, res.text
    assert res.json() == {
        "email": "ann@example.com",
        "plan": {"plan": "creator", "billing": "monthly", "periodEnd": period_end},
        "previewsLeft": 2,
        "previewsPerDay": 3,
        "spentKes": 1800,
        "spentUsd": 0,
    }
    # Same email-OR-IP window the preview endpoint enforces.
    table, params = ann["count_params"]
    assert table == "voice_previews"
    assert params["or"] == '(email.eq."ann@example.com",ip.eq."41.90.1.2")'
    assert params["created_at"].startswith("gte.") and params["created_at"].endswith("T00:00:00Z")
    [plan_q] = [p for t, p in ann["selects"] if t == "voice_subscriptions" and p.get("status") == "eq.active"]
    assert plan_q["email"] == "eq.ann@example.com" and plan_q["order"] == "created_at.desc"
    assert plan_q["period_end"].startswith("gt.") and plan_q["limit"] == "1"


def test_account_picks_the_newest_active_plan(ann, client):
    newest_end = _iso(300)
    ann["tables"]["voice_subscriptions"] = [
        _sub("vs_a", "starter", "active", _iso(5), 300, 25),
        _sub("vs_b", "pro", "active", newest_end, 40000, 2, billing="yearly"),
    ]
    res = client.get(f"{BASE}/account", headers=AUTH)
    assert res.status_code == 200, res.text
    assert res.json()["plan"] == {"plan": "pro", "billing": "yearly", "periodEnd": newest_end}


def test_account_expired_or_past_period_plan_is_null(ann, client):
    ann["tables"]["voice_subscriptions"] = [
        _sub("vs_exp", "creator", "expired", _iso(-3), 1500, 33),
        # Still marked active, but its period ended yesterday.
        _sub("vs_lapsed", "pro", "active", _iso(-1), 4000, 31),
        _sub("vs_fail", "business", "failed", None, 9000, 1),
        _sub("vs_other", "pro", "active", _iso(10), 4000, 1, email="bob@example.com"),
    ]
    res = client.get(f"{BASE}/account", headers=AUTH)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["plan"] is None
    assert body["spentKes"] == 5500  # the expired and the lapsed-but-active plan were still paid for


def test_account_previews_left_clamps_at_zero(ann, client):
    ann["count"] = 7
    res = client.get(f"{BASE}/account", headers=AUTH)
    assert res.status_code == 200, res.text
    assert res.json()["previewsLeft"] == 0 and res.json()["previewsPerDay"] == 3


def test_account_preview_count_failure_shows_the_full_allowance(ann, client, monkeypatch):
    async def broken(table, params):
        raise db.DbError("count down", 503)

    monkeypatch.setattr(db, "count", broken)
    res = client.get(f"{BASE}/account", headers=AUTH)
    assert res.status_code == 200, res.text
    assert res.json()["previewsLeft"] == 3


def test_account_spent_kes_sums_ready_clips_and_paid_plans(ann, client):
    ann["tables"]["voice_jobs"] = [
        _job("vj_1", "ready", 195, amount_usd=1.5),
        _job("vj_2", "ready", 390, amount_usd=3.0),
        _job("vj_3", "failed", 1000),
        _job("vj_4", "paying", 2000),
        _job("vj_5", "generating", 3000),
        _job("vj_6", "ready", 777, email="bob@example.com"),
    ]
    ann["tables"]["voice_subscriptions"] = [
        _sub("vs_1", "starter", "expired", _iso(-5), 300, 35, amount_usd=2.32),
        _sub("vs_2", "creator", "active", _iso(25), 1500, 5, amount_usd=11.6),
        _sub("vs_3", "pro", "pending", None, 4000, 0),
        _sub("vs_4", "pro", "failed", None, 4000, 0),
    ]
    res = client.get(f"{BASE}/account", headers=AUTH)
    assert res.status_code == 200, res.text
    assert res.json()["spentKes"] == 195 + 390 + 300 + 1500
    assert res.json()["spentUsd"] == 18.42
    spend_qs = [(t, p) for t, p in ann["selects"] if p.get("select") == "amount_kes,amount_usd"]
    assert sorted(t for t, _ in spend_qs) == ["voice_jobs", "voice_subscriptions"]
    for _, p in spend_qs:
        assert p["email"] == "eq.ann@example.com" and p["limit"] == "1000"


def test_account_with_nothing_bought(ann, client):
    res = client.get(f"{BASE}/account", headers=AUTH)
    assert res.status_code == 200, res.text
    assert res.json() == {"email": "ann@example.com", "plan": None, "previewsLeft": 3,
                          "previewsPerDay": 3, "spentKes": 0, "spentUsd": 0}


@pytest.mark.parametrize("broken_call,broken_table", [
    ("select_one", "voice_subscriptions"),  # the plan
    ("select", "voice_subscriptions"),  # plan spend
    ("select", "voice_jobs"),  # clip spend
])
def test_account_db_failure_is_503(ann, client, monkeypatch, broken_call, broken_table):
    working = getattr(db, broken_call)

    async def flaky(table, params):
        if table == broken_table:
            raise db.DbError("down", 503)
        return await working(table, params)

    monkeypatch.setattr(db, broken_call, flaky)
    res = client.get(f"{BASE}/account", headers=AUTH)
    assert res.status_code == 503
    assert res.json() == {"detail": "Your account is unavailable right now. Please try again."}


def test_cached_preview_is_free_and_skips_the_render(fake, client, monkeypatch):
    from app import renders

    async def hit(key):
        return {"storage_path": f"renders/{key}.mp3", "seconds": 31}

    async def never(*a, **k):
        raise AssertionError("must not render a cached preview")

    monkeypatch.setattr(renders, "find", hit)
    monkeypatch.setattr(routes_public, "render_mp3", never)
    fake["count"] = 99  # over the daily limit: a cached preview still plays
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"})
    assert res.status_code == 200, res.text
    assert res.json()["seconds"] == 31 and "/renders/" in res.json()["audioUrl"]
    assert fake["inserts"] == [] and fake["uploads"] == []


def test_cache_key_changes_with_voice_style_and_words():
    from app import renders

    base = renders.cache_key("Habari yako.", "wanjiru", "sw", "general")
    assert base == renders.cache_key("Habari yako.", "wanjiru", "sw", "general")
    assert base != renders.cache_key("Habari yako!", "wanjiru", "sw", "general")
    assert base != renders.cache_key("Habari yako.", "kamau", "sw", "general")
    assert base != renders.cache_key("Habari yako.", "wanjiru", "sw", "documentary")
    # An old id for the same voice is the same audio.
    assert base == renders.cache_key("Habari yako.", "amara", "sw", "general")


def test_preview_speaks_the_translation_and_returns_it(fake, client, monkeypatch):
    async def to_swahili(script, language):
        return "Karibu sana. Hii ni hati fupi ya majaribio ya sauti.", True

    monkeypatch.setattr(routes_public.translate, "for_language", to_swahili)
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["translated"] is True
    assert body["script"] == "Karibu sana. Hii ni hati fupi ya majaribio ya sauti."
    assert fake["rendered"][0] == body["script"][:50]


def test_preview_in_its_own_language_is_read_as_written(fake, client):
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"})
    assert res.status_code == 200, res.text
    assert res.json()["script"] == SCRIPT and res.json()["translated"] is False
    assert fake["translated"] == (SCRIPT, "sw")


def test_preview_translation_failure_uses_no_preview(fake, client, monkeypatch):
    async def broken(script, language):
        raise routes_public.translate.TranslateError("gemini-3.8-flash returned 429")

    monkeypatch.setattr(routes_public.translate, "for_language", broken)
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"})
    assert res.status_code == 503
    assert "translate" in res.json()["detail"]
    assert fake["inserts"] == [] and "rendered" not in fake


def test_preview_refuses_a_translation_over_the_limit(fake, client, monkeypatch):
    async def long_one(script, language):
        return "a" * (routes_public.MAX_PAYG_CHARS + 1), True

    monkeypatch.setattr(routes_public.translate, "for_language", long_one)
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "email": "ann@example.com"})
    assert res.status_code == 400
    assert fake["inserts"] == []


# "ki" and the rest were dropped after the 2026-10-29 quality test.
@pytest.mark.parametrize("language", ["", "xx", "english", "sw-ke", "ki", "kam", "rw", "so", "ln", "ak", "pt"])
def test_preview_refuses_unlisted_languages(fake, client, language):
    res = client.post(f"{BASE}/previews", json={**PREVIEW, "language": language, "email": "ann@example.com"})
    assert res.status_code == 400
    assert "translated" not in fake
