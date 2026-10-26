"""Payment lifecycle tests with an in-memory database and a faked Paystack."""

import asyncio
import json
import sys
import types
from datetime import datetime, timedelta, timezone

import pytest

try:  # tts.py is written in parallel; stub it if it cannot be imported yet.
    import app.tts  # noqa: F401
except Exception:  # noqa: BLE001
    stub = types.ModuleType("app.tts")

    class TtsError(Exception):
        pass

    async def render_mp3(text, voice_id, language):
        return b"ID3fake", 12

    stub.TtsError = TtsError
    stub.render_mp3 = render_mp3
    sys.modules["app.tts"] = stub

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db, jobs, paystack, routes_payments

JOB_ID = "vj_" + "a" * 24
SUB_ID = "vs_" + "b" * 24


def _iso(minutes_ago=0):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


class FakeDb:
    def __init__(self):
        self.tables: dict[str, dict[str, dict]] = {}
        self.calls: list[tuple[str, str]] = []

    def _rows(self, table):
        return self.tables.setdefault(table, {})

    @staticmethod
    def _matches(row, params):
        for key, cond in params.items():
            if key in ("select", "limit"):
                continue
            op, _, value = cond.partition(".")
            current = row.get(key)
            if op == "eq":
                if str(current) != value:
                    return False
            elif op in ("lt", "gte"):
                # Timestamps here are all isoformat() UTC, so string order is time order.
                if current is None:
                    return False
                if op == "lt" and not str(current) < value:
                    return False
                if op == "gte" and not str(current) >= value:
                    return False
            else:
                raise AssertionError(f"unsupported filter {cond!r}")
        return True

    async def count(self, table, params):
        self.calls.append(("count", table))
        return sum(1 for row in self._rows(table).values() if self._matches(row, params))

    async def select_one(self, table, params):
        self.calls.append(("select_one", table))
        for row in self._rows(table).values():
            if self._matches(row, params):
                return dict(row)
        return None

    async def insert(self, table, row, *, ignore_duplicates=False):
        self.calls.append(("insert", table))
        key = row.get("id") or row.get("event_key")
        rows = self._rows(table)
        if key in rows:
            if ignore_duplicates:
                return None
            raise db.DbError("duplicate", 409)
        rows[key] = {"created_at": _iso(), **row}
        return dict(rows[key])

    async def update(self, table, match, patch):
        self.calls.append(("update", table))
        out = []
        for row in self._rows(table).values():
            if self._matches(row, match):
                row.update(patch)
                out.append(dict(row))
        return out

    async def upload(self, path, data, content_type="audio/mpeg"):
        self.uploaded = (path, data)

    async def signed_url(self, path, expires_in=3600, download_name=None):
        return f"https://signed/{path}?download={download_name}"


@pytest.fixture
def env(monkeypatch):
    fake = FakeDb()
    for name in ("select_one", "insert", "update", "upload", "signed_url", "count"):
        monkeypatch.setattr(db, name, getattr(fake, name))
    monkeypatch.setattr(paystack, "is_configured", lambda: True)
    monkeypatch.setattr(paystack, "verify_webhook_signature", lambda raw, sig: sig == "good")

    calls = []

    async def fake_mark(job_id, tx):
        calls.append((job_id, tx))
        return True

    monkeypatch.setattr(jobs, "mark_paid_and_generate", fake_mark)

    started = []
    monkeypatch.setattr(jobs, "_start_generate", started.append)

    async def init_tx(**kwargs):
        return {"access_code": "ac_test"}

    monkeypatch.setattr(paystack, "initialize_transaction", init_tx)

    app = FastAPI()
    app.include_router(routes_payments.router)
    return types.SimpleNamespace(db=fake, client=TestClient(app), mark_calls=calls, started=started,
                                 monkeypatch=monkeypatch)


def _job(amount_kes=195, status="paying"):
    return {
        "id": JOB_ID, "email": "a@b.co", "voice_id": "sw-ke-csagent-4", "language": "sw",
        "script": "Karibu sana kwa Mikaka Voice leo.", "chars": 33, "projected_seconds": 2,
        "billed_seconds": 60, "amount_kes": amount_kes, "amount_usd": 1.5, "status": status,
    }


def _sub(amount_kes=1945, billing="monthly"):
    return {
        "id": SUB_ID, "email": "a@b.co", "plan": "starter", "billing": billing, "method": "mpesa",
        "amount_kes": amount_kes, "amount_usd": 15.0, "status": "pending",
    }


def _post_webhook(client, payload, sig="good"):
    return client.post(
        "/paystack/webhook",
        content=json.dumps(payload).encode(),
        headers={"x-paystack-signature": sig, "content-type": "application/json"},
    )


def _charge(reference, amount, currency="KES", purpose="payg_job"):
    return {"event": "charge.success",
            "data": {"reference": reference, "amount": amount, "currency": currency, "status": "success",
                     "metadata": {"purpose": purpose}}}


def test_bad_signature_rejected(env):
    env.db.tables["voice_jobs"] = {JOB_ID: _job()}
    res = _post_webhook(env.client, _charge(JOB_ID, 19500), sig="bad")
    assert res.status_code == 401
    assert env.mark_calls == []
    assert env.db.tables.get("voice_webhook_events", {}) == {}


def test_payg_success_marks_paid_once_even_on_duplicate(env):
    env.db.tables["voice_jobs"] = {JOB_ID: _job()}
    first = _post_webhook(env.client, _charge(JOB_ID, 19500))
    second = _post_webhook(env.client, _charge(JOB_ID, 19500))
    assert first.status_code == 200 and second.status_code == 200
    assert second.json() == {"ok": True}
    assert len(env.mark_calls) == 1
    assert env.mark_calls[0][0] == JOB_ID


def test_payg_amount_mismatch_not_paid(env):
    env.db.tables["voice_jobs"] = {JOB_ID: _job()}
    res = _post_webhook(env.client, _charge(JOB_ID, 100))
    assert res.status_code == 200
    assert env.mark_calls == []
    res = _post_webhook(env.client, _charge(JOB_ID, 19500, currency="USD"))
    assert env.mark_calls == []


def test_mark_paid_guard_refuses_wrong_amount(env, monkeypatch):
    # Exercise the real function: it re-checks the amount before flipping status.
    monkeypatch.undo()
    fake = FakeDb()
    for name in ("select_one", "insert", "update"):
        monkeypatch.setattr(db, name, getattr(fake, name))
    fake.tables["voice_jobs"] = {JOB_ID: _job()}
    ok = asyncio.run(jobs.mark_paid_and_generate(JOB_ID, {"amount": 1, "currency": "KES"}))
    assert ok is False
    assert fake.tables["voice_jobs"][JOB_ID]["status"] == "paying"


def test_webhook_activates_plan(env):
    env.db.tables["voice_subscriptions"] = {SUB_ID: _sub()}
    res = _post_webhook(env.client, _charge(SUB_ID, 194500, purpose="vs_plan"))
    assert res.status_code == 200
    row = env.db.tables["voice_subscriptions"][SUB_ID]
    assert row["status"] == "active" and row["period_end"]


def test_get_plan_activates_on_verify(env):
    env.db.tables["voice_subscriptions"] = {SUB_ID: _sub(billing="yearly")}

    async def verify(ref):
        assert ref == SUB_ID
        return {"status": "success", "amount": 194500, "currency": "KES", "metadata": {}}

    env.monkeypatch.setattr(paystack, "verify_transaction", verify)
    res = env.client.get(f"/plans/{SUB_ID}")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "active" and body["plan"] == "starter" and body["billing"] == "yearly"
    row = env.db.tables["voice_subscriptions"][SUB_ID]
    assert row["period_end"][:4] == str(int(row["period_start"][:4]) + 1)


def test_get_plan_amount_mismatch_stays_pending(env):
    env.db.tables["voice_subscriptions"] = {SUB_ID: _sub()}

    async def verify(ref):
        return {"status": "success", "amount": 100, "currency": "KES"}

    env.monkeypatch.setattr(paystack, "verify_transaction", verify)
    res = env.client.get(f"/plans/{SUB_ID}")
    assert res.status_code == 200
    assert res.json()["status"] == "pending"
    assert "periodEnd" not in res.json()


def test_get_plan_missing_is_404(env):
    assert env.client.get("/plans/vs_" + "c" * 24).status_code == 404


def test_get_job_refreshes_paying_job(env):
    env.db.tables["voice_jobs"] = {JOB_ID: _job()}

    async def verify(ref):
        return {"status": "success", "amount": 19500, "currency": "KES"}

    env.monkeypatch.setattr(paystack, "verify_transaction", verify)
    res = env.client.get(f"/jobs/{JOB_ID}")
    assert res.status_code == 200
    assert env.mark_calls == [(JOB_ID, {"status": "success", "amount": 19500, "currency": "KES"})]


def test_get_job_ready_returns_signed_audio(env):
    env.db.tables["voice_jobs"] = {JOB_ID: {**_job(status="ready"), "audio_path": f"clips/{JOB_ID}.mp3",
                                            "audio_seconds": 12, "licence_id": "VS-2026-ABC234"}}
    body = env.client.get(f"/jobs/{JOB_ID}").json()
    assert body["status"] == "ready" and body["seconds"] == 12 and body["licenceId"] == "VS-2026-ABC234"
    assert "mikaka-voice-VS-2026-ABC234.mp3" in body["audioUrl"]


def test_generate_issues_licence(env, monkeypatch):
    env.db.tables["voice_jobs"] = {JOB_ID: _job(status="generating")}

    async def render(text, voice_id, language):
        return b"ID3audio", 9

    monkeypatch.setattr(jobs, "render_mp3", render)
    asyncio.run(jobs.generate(JOB_ID))
    row = env.db.tables["voice_jobs"][JOB_ID]
    assert row["status"] == "ready" and row["audio_seconds"] == 9
    lic = env.db.tables["voice_licences"][row["licence_id"]]
    assert lic["job_id"] == JOB_ID and lic["tier"] == "Commercial" and lic["voice_name"] == "Call Centre Agent 4"


# ---- webhook: handle first, record after ----------------------------------


def test_webhook_handling_failure_returns_500_and_retry_succeeds(env):
    env.db.tables["voice_jobs"] = {JOB_ID: _job()}
    attempts = []

    async def flaky_mark(job_id, tx):
        attempts.append(job_id)
        if len(attempts) == 1:
            raise db.DbError("database briefly down", 503)
        return True

    env.monkeypatch.setattr(jobs, "mark_paid_and_generate", flaky_mark)
    first = _post_webhook(env.client, _charge(JOB_ID, 19500))
    assert first.status_code == 500
    assert env.db.tables.get("voice_webhook_events", {}) == {}  # not recorded, so the retry is handled
    second = _post_webhook(env.client, _charge(JOB_ID, 19500))
    assert second.status_code == 200
    assert attempts == [JOB_ID, JOB_ID]
    assert f"charge.success:{JOB_ID}" in env.db.tables["voice_webhook_events"]
    third = _post_webhook(env.client, _charge(JOB_ID, 19500))
    assert third.status_code == 200 and attempts == [JOB_ID, JOB_ID]


def test_webhook_records_event_only_after_handling(env):
    env.db.tables["voice_subscriptions"] = {SUB_ID: _sub()}
    res = _post_webhook(env.client, _charge(SUB_ID, 194500, purpose="vs_plan"))
    assert res.status_code == 200
    order = [c for c in env.db.calls if c[1] in ("voice_subscriptions", "voice_webhook_events")]
    assert order.index(("update", "voice_subscriptions")) < order.index(("insert", "voice_webhook_events"))


# ---- strict ids --------------------------------------------------------------


@pytest.mark.parametrize("bad", [
    "vj_" + "A" * 24, "vj_" + "a" * 23, "vj_" + "a" * 24 + "0", "vs_" + "b" * 24,
    'vj_aaaa",id.neq."x', "vj_" + "a" * 23 + "%",
])
def test_get_job_rejects_bad_ids_without_db(env, bad):
    res = env.client.get(f"/jobs/{bad}")
    assert res.status_code == 404
    assert env.db.calls == []


def test_get_plan_rejects_job_id_without_db(env):
    assert env.client.get(f"/plans/{JOB_ID}").status_code == 404
    assert env.db.calls == []


@pytest.mark.parametrize("ref", ["vj_" + "a" * 23 + ")", "VJ_" + "a" * 24, "T_123", "", 12345, None])
def test_webhook_ignores_foreign_references(env, ref):
    env.db.tables["voice_jobs"] = {JOB_ID: _job()}
    res = _post_webhook(env.client, _charge(ref, 19500))
    assert res.status_code == 200
    assert env.mark_calls == [] and env.db.calls == []


def test_loaders_refuse_bad_ids():
    assert asyncio.run(jobs.load_job("vj_nope")) is None
    assert asyncio.run(jobs.load_job(SUB_ID)) is None
    assert asyncio.run(jobs.load_subscription(JOB_ID)) is None
    assert asyncio.run(jobs.mark_paid_and_generate("vj_nope", None)) is False


# ---- checkout rate limit ------------------------------------------------------


def _payg_body(email="Buyer@Example.com"):
    return {"previewId": "stale-preview", "script": "Karibu sana kwa Mikaka Voice leo.",
            "voiceId": "sw-ke-csagent-4", "language": "sw", "email": email}


def _plan_body(email="buyer@example.com"):
    return {"plan": "starter", "billing": "monthly", "email": email, "method": "mpesa"}


def test_payg_checkout_rate_limited_per_email(env):
    for _ in range(10):
        res = env.client.post("/payg/checkout", json=_payg_body())
        assert res.status_code == 200, res.text
    stored = list(env.db.tables["voice_jobs"].values())
    assert {r["email"] for r in stored} == {"buyer@example.com"}
    blocked = env.client.post("/payg/checkout", json=_payg_body("buyer@example.com"))
    assert blocked.status_code == 429
    assert blocked.json() == {"detail": "Too many checkout attempts. Please wait a little and try again."}
    assert len(env.db.tables["voice_jobs"]) == 10
    assert env.client.post("/payg/checkout", json=_payg_body("other@example.com")).status_code == 200


def test_checkout_rate_limit_ignores_old_rows(env):
    env.db.tables["voice_jobs"] = {
        f"vj_{i:024x}": {**_job(), "id": f"vj_{i:024x}", "email": "buyer@example.com", "created_at": _iso(90)}
        for i in range(12)
    }
    assert env.client.post("/payg/checkout", json=_payg_body()).status_code == 200


def test_plan_checkout_rate_limited_per_email(env):
    for _ in range(10):
        assert env.client.post("/plans/checkout", json=_plan_body()).status_code == 200
    blocked = env.client.post("/plans/checkout", json=_plan_body("BUYER@example.com "))
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "Too many checkout attempts. Please wait a little and try again."


@pytest.mark.parametrize("language", ["", "english", "e", "EN1", "sw-KE", "s w"])
def test_payg_checkout_validates_language(env, language):
    res = env.client.post("/payg/checkout", json={**_payg_body(), "language": language})
    assert res.status_code == 400


def test_payg_checkout_rejects_bad_email(env):
    res = env.client.post("/payg/checkout", json=_payg_body('a"b@x.co'))
    assert res.status_code == 400


# ---- resuming stuck renders -----------------------------------------------------

STALE_ID = "vj_" + "c" * 24
FRESH_ID = "vj_" + "d" * 24


def _seed_generating(fake):
    fake.tables["voice_jobs"] = {
        STALE_ID: {**_job(status="generating"), "id": STALE_ID, "updated_at": _iso(10)},
        FRESH_ID: {**_job(status="generating"), "id": FRESH_ID, "updated_at": _iso(0)},
        JOB_ID: {**_job(status="ready"), "updated_at": _iso(60)},
    }


def _run_resume(monkeypatch, fake, **kwargs):
    renders = []

    async def render(text, voice_id, language):
        renders.append(text)
        return b"ID3audio", 7

    monkeypatch.setattr(jobs, "render_mp3", render)

    async def go():
        ids = await jobs.resume_stuck_jobs(**kwargs)
        await asyncio.gather(*list(jobs._tasks))
        return ids

    return asyncio.run(go()), renders


def _real_db(monkeypatch):
    fake = FakeDb()
    for name in ("select_one", "insert", "update", "upload", "count"):
        monkeypatch.setattr(db, name, getattr(fake, name))
    return fake


def test_resume_stuck_jobs_takes_only_stale_generating(monkeypatch):
    fake = _real_db(monkeypatch)
    _seed_generating(fake)
    ids, renders = _run_resume(monkeypatch, fake)
    assert ids == [STALE_ID] and len(renders) == 1
    rows = fake.tables["voice_jobs"]
    assert rows[STALE_ID]["status"] == "ready" and rows[STALE_ID]["licence_id"]
    assert rows[FRESH_ID]["status"] == "generating"
    assert rows[JOB_ID]["status"] == "ready"


def test_resume_on_startup_takes_every_generating_job(monkeypatch):
    fake = _real_db(monkeypatch)
    _seed_generating(fake)
    ids, renders = _run_resume(monkeypatch, fake, startup=True)
    assert sorted(ids) == sorted([STALE_ID, FRESH_ID]) and len(renders) == 2
    assert len(fake.tables["voice_licences"]) == 2


def test_resume_claim_is_atomic(monkeypatch):
    fake = _real_db(monkeypatch)
    _seed_generating(fake)
    ids, _ = _run_resume(monkeypatch, fake)
    again, renders = _run_resume(monkeypatch, fake)
    assert ids == [STALE_ID] and again == [] and renders == []


def test_resume_never_raises_when_db_down(monkeypatch):
    async def broken(*a, **k):
        raise db.DbError("down", 503)

    monkeypatch.setattr(db, "update", broken)
    assert asyncio.run(jobs.resume_stuck_jobs(startup=True)) == []


def test_generate_skips_job_no_longer_generating(monkeypatch):
    fake = _real_db(monkeypatch)
    fake.tables["voice_jobs"] = {JOB_ID: _job(status="ready")}

    async def render(*a):
        raise AssertionError("must not render")

    monkeypatch.setattr(jobs, "render_mp3", render)
    asyncio.run(jobs.generate(JOB_ID))
    assert fake.tables["voice_jobs"][JOB_ID]["status"] == "ready"


def test_generate_finishes_from_existing_licence(monkeypatch):
    fake = _real_db(monkeypatch)
    fake.tables["voice_jobs"] = {JOB_ID: _job(status="generating")}
    fake.tables["voice_licences"] = {"VS-2026-ABC234": {"id": "VS-2026-ABC234", "job_id": JOB_ID,
                                                       "length_seconds": 11}}

    async def render(*a):
        raise AssertionError("must not render twice")

    monkeypatch.setattr(jobs, "render_mp3", render)
    asyncio.run(jobs.generate(JOB_ID))
    row = fake.tables["voice_jobs"][JOB_ID]
    assert row["status"] == "ready" and row["licence_id"] == "VS-2026-ABC234" and row["audio_seconds"] == 11


def test_get_job_resumes_stale_generating(env):
    env.db.tables["voice_jobs"] = {JOB_ID: {**_job(status="generating"), "updated_at": _iso(5)}}
    res = env.client.get(f"/jobs/{JOB_ID}")
    assert res.status_code == 200 and res.json()["status"] == "generating"
    assert env.started == [JOB_ID]
    assert env.db.tables["voice_jobs"][JOB_ID]["updated_at"] > _iso(1)
    env.client.get(f"/jobs/{JOB_ID}")  # just claimed, so a second poll does not resume again
    assert env.started == [JOB_ID]


def test_get_job_leaves_fresh_generating_alone(env):
    env.db.tables["voice_jobs"] = {JOB_ID: {**_job(status="generating"), "updated_at": _iso(1)}}
    assert env.client.get(f"/jobs/{JOB_ID}").status_code == 200
    assert env.started == []
