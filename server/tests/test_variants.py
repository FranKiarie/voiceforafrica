"""Audio versions of a paid clip: who may download which, and the download route."""

import asyncio
import shutil

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db, jobs, routes_payments, variants

JOB_ID = "vj_" + "d" * 24
READY = {"id": JOB_ID, "email": "ann@example.com", "status": "ready", "audio_path": f"clips/{JOB_ID}.mp3",
         "licence_id": "VS-2026-ABC234"}


def test_plan_ladder():
    assert variants.allowed("payg", "mp3") and not variants.allowed("payg", "wav")
    assert variants.allowed("starter", "wav") and variants.allowed("starter", "ogg")
    assert not variants.allowed("starter", "ivr-ulaw")
    assert all(variants.allowed("business", v) for v in variants.VERSIONS)
    assert not variants.allowed("payg", "flac") and not variants.allowed("gold", "mp3")


def test_menu_says_which_plan_unlocks():
    menu = {m["id"]: m for m in variants.menu("starter")}
    assert menu["wav"]["allowed"] and "needs" not in menu["wav"]
    assert menu["ivr-alaw"] == {"id": "ivr-alaw", "label": "Phone system A-law · 8 kHz (G.711)", "allowed": False, "needs": "Creator"}


def test_plan_for_reads_an_active_subscription(monkeypatch):
    seen = {}

    async def one(table, params):
        seen.update(params)
        return {"plan": "pro"}

    monkeypatch.setattr(db, "select_one", one)
    assert asyncio.run(variants.plan_for("ann@example.com")) == "pro"
    assert seen["status"] == "eq.active" and seen["period_end"].startswith("gt.")


def test_plan_for_fails_closed(monkeypatch):
    async def broken(table, params):
        raise db.DbError("down", 503)

    monkeypatch.setattr(db, "select_one", broken)
    assert asyncio.run(variants.plan_for("ann@example.com")) == "payg"
    assert asyncio.run(variants.plan_for(None)) == "payg"


@pytest.fixture
def client(monkeypatch):
    state = {"plan": "payg", "job": dict(READY)}

    async def load_job(job_id):
        return dict(state["job"]) if job_id == JOB_ID else None

    async def plan_for(email):
        return state["plan"]

    async def download(path):
        return b"ID3mp3"

    async def convert(mp3, version):
        return f"{version}:{mp3.decode()}".encode()

    async def audio_link(job):
        return "https://signed/clip.mp3"

    monkeypatch.setattr(jobs, "load_job", load_job)
    monkeypatch.setattr(jobs, "audio_link", audio_link)
    monkeypatch.setattr(variants, "plan_for", plan_for)
    monkeypatch.setattr(variants, "convert", convert)
    monkeypatch.setattr(db, "download", download)
    app = FastAPI()
    app.include_router(routes_payments.router)
    c = TestClient(app)
    c.state = state
    return c


def test_mp3_redirects_to_the_stored_file(client):
    res = client.get(f"/jobs/{JOB_ID}/download", follow_redirects=False)
    assert res.status_code == 302 and res.headers["location"] == "https://signed/clip.mp3"


def test_locked_version_names_the_plan(client):
    res = client.get(f"/jobs/{JOB_ID}/download?version=wav")
    assert res.status_code == 403 and "Starter plan" in res.json()["detail"]


def test_allowed_version_streams_an_attachment(client):
    client.state["plan"] = "creator"
    res = client.get(f"/jobs/{JOB_ID}/download?version=ivr-ulaw")
    assert res.status_code == 200 and res.content == b"ivr-ulaw:ID3mp3"
    assert res.headers["content-type"] == "audio/wav"
    assert res.headers["content-disposition"] == 'attachment; filename="mikaka-voice-VS-2026-ABC234.ulaw.wav"'


def test_unknown_version_and_unready_clip(client):
    client.state["plan"] = "business"
    assert client.get(f"/jobs/{JOB_ID}/download?version=flac").status_code == 400
    client.state["job"]["status"] = "generating"
    assert client.get(f"/jobs/{JOB_ID}/download?version=wav").status_code == 409
    assert client.get("/jobs/vj_" + "e" * 24 + "/download").status_code == 404


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_real_conversion_to_phone_alaw():
    import subprocess

    mp3 = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ac", "1", "-ar", "24000", "-f", "mp3", "-"],
        capture_output=True, check=True,
    ).stdout
    wav = asyncio.run(variants.convert(mp3, "ivr-alaw"))
    assert wav[:4] == b"RIFF" and wav[8:12] == b"WAVE"
    assert int.from_bytes(wav[20:22], "little") == 6  # WAVE_FORMAT_ALAW
    assert int.from_bytes(wav[24:28], "little") == 8000
