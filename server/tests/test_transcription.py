"""Transcription: pricing, reading model replies, fallback, documents, endpoints and the run."""

import asyncio
import json
import shutil
import struct
import subprocess
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import db, gcs, paystack, routes_payments, routes_transcripts, transcribe, transcripts
from app.pricing import transcribe_quote
from app.transcribe import Segment

TID = "vt_" + "c" * 24


# ---- pricing -----------------------------------------------------------------


def test_quote_is_per_started_minute_with_a_minimum():
    assert transcribe_quote(0.4) == {"seconds": 1, "minutes": 1, "usd": 0.1, "kes": 15}
    assert transcribe_quote(61) == {"seconds": 61, "minutes": 2, "usd": 0.2, "kes": 30}
    assert transcribe_quote(3 * 3600)["minutes"] == 180
    assert transcribe_quote(3 * 3600)["kes"] == 2330


# ---- reading model replies ---------------------------------------------------------


def _w(text, start, end, speaker="spk:0"):
    return {"text": text, "start": start, "end": end, "speaker": speaker}


def test_group_words_splits_on_speaker_pause_and_sentence():
    words = [
        _w("Habari,", 0.3, 0.7), _w("karibu.", 0.8, 1.2),
        _w("Asante.", 1.3, 1.8, "spk:1"),
        _w("Tuanze", 4.0, 4.5, "spk:1"),
    ]
    segs = transcribe.group_words(words)
    assert [s.text for s in segs] == ["Habari, karibu.", "Asante.", "Tuanze"]
    assert segs[1].start == 1.3 and segs[2].start == 4.0


def test_group_words_closes_long_sentences():
    words = [_w(f"w{i}", i * 0.5, i * 0.5 + 0.4) for i in range(14)] + [_w("end.", 7.0, 7.4), _w("next", 7.5, 7.9)]
    segs = transcribe.group_words(words)
    assert segs[0].text.endswith("end.") and segs[1].text == "next"


def test_parse_interaction_reads_word_annotations():
    body = {"steps": [{"content": [{"text": "Habari, I'm Onyango.", "annotations": [
        {"type": "word_info", "text": "Habari,", "start_offset": "0.300s", "end_offset": "0.700s", "speaker": "spk:0"},
        {"type": "word_info", "text": "I'm", "start_offset": "1.200s", "end_offset": "1.400s", "speaker": "spk:0"},
        {"type": "word_info", "text": "Onyango.", "start_offset": "1.400s", "end_offset": "2s", "speaker": "spk:0"},
    ]}]}]}
    segs = transcribe._label_speakers(transcribe.parse_interaction(body, 1500))
    assert len(segs) == 1
    assert segs[0].text == "Habari, I'm Onyango." and segs[0].speaker == "Speaker 1"
    assert segs[0].start == 0.3 and segs[0].end == 2.0


def test_parse_interaction_without_words_keeps_the_text():
    body = {"steps": [{"content": [{"type": "text", "text": "Hello there"}]}]}
    assert transcribe.parse_interaction(body, 30) == [Segment(0.0, 30, None, "Hello there")]


def test_parse_fallback_clamps_times_and_skips_empty():
    items = [{"start": -2, "end": 4, "speaker": "Speaker 1", "text": "Sawa"}, {"start": 5, "end": 9999, "text": "  "},
             {"start": 10, "end": 9999, "text": "Mwisho"}]
    body = {"candidates": [{"content": {"parts": [{"text": json.dumps(items)}]}}]}
    segs = transcribe.parse_fallback(body, 60)
    assert [(s.start, s.end, s.text) for s in segs] == [(0.0, 4.0, "Sawa"), (10.0, 60, "Mwisho")]


# ---- primary model first, advanced model when it cannot ----------------------------


def _run(coro):
    return asyncio.run(coro)


def test_part_uses_transcribe_model_when_it_works(monkeypatch):
    async def primary(client, audio, code, speakers, part):
        assert code == "sw-KE"
        return [Segment(0, 1, "spk:0", "Habari")]

    async def fallback(*a):
        raise AssertionError("fallback must not run")

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    segs, model = _run(transcribe.transcribe_part(None, b"mp3", "sw", True))
    assert model == "gemini-3.5-transcribe" and segs[0].speaker == "Speaker 1"


def test_part_falls_back_when_transcribe_model_fails(monkeypatch):
    seen = []

    async def primary(*a):
        seen.append("primary")
        raise transcribe.TranscribeError("400 bad", retryable=False)

    async def fallback(client, audio, language, speakers, part):
        return [Segment(0, 1, "Speaker 1", "Habari")]

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    segs, model = _run(transcribe.transcribe_part(None, b"mp3", None, True))
    assert seen == ["primary"] and model == "gemini-3.8-flash" and segs[0].text == "Habari"


def test_part_falls_back_when_transcribe_model_hears_nothing(monkeypatch):
    async def primary(*a):
        return []

    async def fallback(*a):
        return []

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    assert _run(transcribe.transcribe_part(None, b"mp3", "en", False)) == ([], "gemini-3.8-flash")


def test_unlisted_language_goes_straight_to_advanced_model(monkeypatch):
    async def primary(*a):
        raise AssertionError("Yoruba is not a transcribe-model language")

    async def fallback(client, audio, language, speakers, part):
        assert language == "yo"
        return [Segment(0, 1, None, "Ẹ káàbọ̀")]

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    assert _run(transcribe.transcribe_part(None, b"mp3", "yo", False))[1] == "gemini-3.8-flash"


def test_retryable_errors_are_retried_then_fall_back(monkeypatch):
    tries = []

    async def primary(*a):
        tries.append(1)
        raise transcribe.TranscribeError("429", retryable=True, wait=0)

    async def fallback(*a):
        return [Segment(0, 1, None, "ok")]

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    assert _run(transcribe.transcribe_part(None, b"mp3", None, False))[1] == "gemini-3.8-flash"
    assert len(tries) == transcribe.PRIMARY_ATTEMPTS


# ---- documents -----------------------------------------------------------------------


SEGS = [
    Segment(0.3, 2.0, "Speaker 1", "Habari, karibu."),
    Segment(2.2, 4.0, "Speaker 1", "Tuanze."),
    Segment(3725.5, 3727.25, "Speaker 2", "Asante."),
]


def test_srt_and_vtt_cues():
    srt = transcribe.to_srt(SEGS)
    assert srt.startswith("1\n00:00:00,300 --> 00:00:02,000\nSpeaker 1: Habari, karibu.\n")
    assert "3\n01:02:05,500 --> 01:02:07,250\nSpeaker 2: Asante." in srt
    vtt = transcribe.to_vtt(SEGS)
    assert vtt.startswith("WEBVTT\n\n00:00:00.300 --> 00:00:02.000\n")


def test_txt_joins_one_speakers_turn_into_a_paragraph():
    txt = transcribe.to_txt(SEGS, "Transcript of a.mp3")
    assert "[00:00:00] Speaker 1: Habari, karibu. Tuanze." in txt
    assert "[01:02:05] Speaker 2: Asante." in txt
    assert transcribe.word_count(SEGS) == 4


# ---- endpoints ---------------------------------------------------------------------------


class FakeDb:
    def __init__(self):
        self.rows: dict[str, dict] = {}
        self.uploads: dict[str, bytes] = {}

    @staticmethod
    def _ok(row, match):
        for key, cond in match.items():
            if key in ("select", "limit"):
                continue
            op, _, value = cond.partition(".")
            current = row.get(key)
            if op == "eq" and str(current) != value:
                return False
            if op == "is" and value == "null" and current is not None:
                return False
            if op == "gte" and not (current is not None and str(current) >= value):
                return False
            if op == "lt" and not (current is not None and str(current) < value):
                return False
        return True

    async def count(self, table, params):
        return sum(1 for r in self.rows.values() if self._ok(r, params))

    async def select_one(self, table, params):
        return next((dict(r) for r in self.rows.values() if self._ok(r, params)), None)

    async def insert(self, table, row, *, ignore_duplicates=False):
        self.rows[row["id"]] = {"created_at": "2026-10-28T00:00:00+00:00", "access_code": None, **row}
        return dict(self.rows[row["id"]])

    async def update(self, table, match, patch):
        out = []
        for r in self.rows.values():
            if self._ok(r, match):
                r.update(patch)
                out.append(dict(r))
        return out

    async def upload(self, path, data, content_type="audio/mpeg"):
        self.uploads[path] = data

    async def download(self, path):
        return self.uploads[path]

    async def signed_url(self, path, expires_in=3600, download_name=None):
        return f"https://signed/{path}?download={download_name}"


@pytest.fixture
def env(monkeypatch):
    fake = FakeDb()
    for name in ("count", "select_one", "insert", "update", "upload", "download", "signed_url"):
        monkeypatch.setattr(db, name, getattr(fake, name))
    store = {"size": 5_000_000, "generation": 111, "deleted": [], "measured": 0}

    async def upload_url(path, content_type):
        return f"https://storage/{path}?ct={content_type}", gcs.upload_headers(content_type)

    async def read_url(path, generation=None):
        return f"https://storage/{path}?read&generation={generation}"

    async def stat(path):
        return None if store["size"] is None else (store["size"], store["generation"])

    async def delete(path):
        store["deleted"].append(path)

    monkeypatch.setattr(gcs, "upload_url", upload_url)
    monkeypatch.setattr(gcs, "read_url", read_url)
    monkeypatch.setattr(gcs, "stat", stat)
    monkeypatch.setattr(gcs, "delete", delete)
    store["seconds"] = 3700.0
    store["audio"] = True

    async def probe(url):
        store["measured"] += 1
        assert url.endswith(f"generation={store['generation']}")
        return transcribe.Probe(store["seconds"], audio=store["audio"])

    monkeypatch.setattr(routes_transcripts, "probe", probe)
    monkeypatch.setattr(paystack, "is_configured", lambda: True)
    inits = []

    async def init_tx(**kwargs):
        inits.append(kwargs)
        return {"access_code": f"ac_{len(inits)}"}

    monkeypatch.setattr(paystack, "initialize_transaction", init_tx)
    spawned = []
    monkeypatch.setattr(transcripts, "spawn", lambda coro: (spawned.append(coro), coro.close()))
    app = FastAPI()
    app.include_router(routes_transcripts.router)
    app.include_router(routes_payments.router)
    return types.SimpleNamespace(db=fake, store=store, inits=inits, spawned=spawned, client=TestClient(app))


UPLOAD = {"fileName": "Mkutano wa Jumanne.m4a", "size": 5_000_000, "email": " Ann@Example.com ", "language": "sw"}


def _upload(env, **over):
    return env.client.post("/transcripts/uploads", json={**UPLOAD, **over})


def test_upload_link_and_row(env):
    res = _upload(env)
    assert res.status_code == 200, res.text
    body = res.json()
    tid = body["transcriptId"]
    assert tid.startswith("vt_") and body["contentType"] == "audio/mp4"
    assert body["uploadUrl"] == f"https://storage/uploads/{tid}.m4a?ct=audio/mp4"
    # The browser must send the signed write-once and size-range headers.
    assert body["uploadHeaders"] == {
        "Content-Type": "audio/mp4",
        "x-goog-content-length-range": "0,524288000",
        "x-goog-if-generation-match": "0",
    }
    row = env.db.rows[tid]
    assert row["email"] == "ann@example.com" and row["status"] == "uploading" and row["language"] == "sw"


def test_quote_records_the_generation_and_measures_once(env):
    tid = _upload(env).json()["transcriptId"]
    env.client.post(f"/transcripts/{tid}/quote")
    env.client.post(f"/transcripts/{tid}/quote")
    assert env.db.rows[tid]["upload_generation"] == 111 and env.store["measured"] == 1
    env.store["generation"] = 222  # a new object at the path is measured again
    env.store["seconds"] = 30.0
    assert env.client.post(f"/transcripts/{tid}/quote").json()["minutes"] == 1
    assert env.store["measured"] == 2


def test_quote_refuses_a_file_with_no_sound(env):
    tid = _upload(env).json()["transcriptId"]
    env.store["audio"] = False
    res = env.client.post(f"/transcripts/{tid}/quote")
    assert res.status_code == 400 and "sound" in res.json()["detail"]


def test_checkout_loses_a_race_with_a_new_quote(env, monkeypatch):
    tid = _upload(env).json()["transcriptId"]
    env.client.post(f"/transcripts/{tid}/quote")
    real_update = db.update

    async def requote_first(table, match, patch):
        if patch.get("access_code") == routes_transcripts.STARTING:
            env.db.rows[tid]["amount_kes"] = 15  # a quote landed between read and claim
        return await real_update(table, match, patch)

    monkeypatch.setattr(db, "update", requote_first)
    res = env.client.post(f"/transcripts/{tid}/checkout")
    assert res.status_code == 409 and env.inits == []


def test_failed_paystack_start_frees_the_row(env, monkeypatch):
    tid = _upload(env).json()["transcriptId"]
    env.client.post(f"/transcripts/{tid}/quote")

    async def broken(**kwargs):
        raise paystack.PaystackError("down")

    monkeypatch.setattr(paystack, "initialize_transaction", broken)
    assert env.client.post(f"/transcripts/{tid}/checkout").status_code == 502
    assert env.db.rows[tid]["access_code"] is None


@pytest.mark.parametrize(
    "over, words",
    [
        ({"fileName": "notes.docx"}, "Upload MP3"),
        ({"size": 10}, "empty"),
        ({"size": 600 * 1024 * 1024}, "500 MB"),
        ({"email": "nope"}, "valid email"),
        ({"language": "klingon"}, "listed language"),
    ],
)
def test_upload_refusals(env, over, words):
    res = _upload(env, **over)
    assert res.status_code == 400 and words in res.json()["detail"]


def test_quote_measures_on_the_server(env):
    tid = _upload(env).json()["transcriptId"]
    res = env.client.post(f"/transcripts/{tid}/quote")
    assert res.status_code == 200, res.text
    assert res.json() == {"transcriptId": tid, "seconds": 3700, "minutes": 62, "amountUsd": 6.2, "amountKes": 805}
    assert env.db.rows[tid]["status"] == "paying"


def test_quote_refuses_over_three_hours(env):
    tid = _upload(env).json()["transcriptId"]
    env.store["seconds"] = 3 * 3600 + 120
    res = env.client.post(f"/transcripts/{tid}/quote")
    assert res.status_code == 400 and "3 h 02 min" in res.json()["detail"]


def test_quote_without_the_file(env):
    tid = _upload(env).json()["transcriptId"]
    env.store["size"] = None
    assert env.client.post(f"/transcripts/{tid}/quote").status_code == 400


def test_checkout_once_then_price_is_fixed(env):
    tid = _upload(env).json()["transcriptId"]
    env.client.post(f"/transcripts/{tid}/quote")
    first = env.client.post(f"/transcripts/{tid}/checkout").json()
    again = env.client.post(f"/transcripts/{tid}/checkout").json()
    assert first["accessCode"] == again["accessCode"] == "ac_1" and len(env.inits) == 1
    assert env.inits[0]["amount_subunits"] == 80500 and env.inits[0]["reference"] == tid
    env.store["seconds"] = 60.0  # a later quote cannot lower the fixed price
    assert env.client.post(f"/transcripts/{tid}/quote").json()["amountKes"] == 805


def test_checkout_needs_a_quote(env):
    tid = _upload(env).json()["transcriptId"]
    assert env.client.post(f"/transcripts/{tid}/checkout").status_code == 409


def test_status_verifies_payment_and_starts(env, monkeypatch):
    tid = _upload(env).json()["transcriptId"]
    env.client.post(f"/transcripts/{tid}/quote")
    env.client.post(f"/transcripts/{tid}/checkout")

    async def verify(ref):
        return {"status": "success", "amount": 80500, "currency": "KES"}

    monkeypatch.setattr(paystack, "verify_transaction", verify)
    body = env.client.get(f"/transcripts/{tid}").json()
    assert body["status"] == "transcribing" and len(env.spawned) == 1


def test_status_wrong_amount_does_not_start(env, monkeypatch):
    tid = _upload(env).json()["transcriptId"]
    env.client.post(f"/transcripts/{tid}/quote")
    env.client.post(f"/transcripts/{tid}/checkout")

    async def verify(ref):
        return {"status": "success", "amount": 100, "currency": "KES"}

    monkeypatch.setattr(paystack, "verify_transaction", verify)
    assert env.client.get(f"/transcripts/{tid}").json()["status"] == "paying" and env.spawned == []


def test_unknown_or_malformed_id_is_404(env):
    assert env.client.get(f"/transcripts/{TID}").status_code == 404
    assert env.client.get("/transcripts/vj_" + "a" * 24).status_code == 404


def test_webhook_routes_transcript_charges(env, monkeypatch):
    calls = []

    async def mark(ref, data):
        calls.append(ref)
        return True

    monkeypatch.setattr(paystack, "verify_webhook_signature", lambda raw, sig: True)
    monkeypatch.setattr(transcripts, "mark_paid_and_start", mark)

    async def no_event(table, params):
        return None

    monkeypatch.setattr(db, "select_one", no_event)

    async def record(table, row, *, ignore_duplicates=False):
        return None

    monkeypatch.setattr(db, "insert", record)
    payload = {"event": "charge.success", "data": {"reference": TID, "amount": 1500, "currency": "KES",
                                                   "metadata": {"purpose": "vt_transcript"}}}
    res = env.client.post("/paystack/webhook", content=json.dumps(payload).encode(),
                          headers={"x-paystack-signature": "x", "content-type": "application/json"})
    assert res.status_code == 200 and calls == [TID]


# ---- the run -------------------------------------------------------------------------------


def test_run_stores_documents_and_deletes_the_upload(env, monkeypatch):
    env.db.rows[TID] = {"id": TID, "status": "transcribing", "upload_path": f"uploads/{TID}.mp3",
                        "file_name": "meeting.mp3", "language": None, "speakers": True, "amount_kes": 15,
                        "upload_generation": 111, "billed_minutes": 62}

    async def fake_file(url, language, speakers, max_seconds):
        # Only the measured upload, and never past what was paid for.
        assert url.endswith("generation=111") and speakers is True and max_seconds == 62 * 60
        return SEGS, ["gemini-3.5-transcribe", "gemini-3.8-flash"]

    monkeypatch.setattr(transcribe, "transcribe_file", fake_file)
    asyncio.run(transcripts.run(TID))
    row = env.db.rows[TID]
    assert row["status"] == "ready" and row["words"] == 4
    assert row["model"] == "gemini-3.5-transcribe,gemini-3.8-flash"
    assert set(env.db.uploads) == {f"transcripts/{TID}.txt", f"transcripts/{TID}.srt", f"transcripts/{TID}.vtt"}
    assert env.store["deleted"] == [f"uploads/{TID}.mp3"]
    body = env.client.get(f"/transcripts/{TID}").json()
    assert body["status"] == "ready" and body["preview"].startswith("Transcript of meeting.mp3")
    assert body["downloads"]["srt"].endswith("download=meeting.srt")


def test_run_failure_lands_on_the_row(env, monkeypatch):
    env.db.rows[TID] = {"id": TID, "status": "transcribing", "upload_path": f"uploads/{TID}.mp3",
                        "file_name": "x.mp3", "speakers": False, "amount_kes": 15}

    async def broken(url, language, speakers, max_seconds):
        raise transcribe.TranscribeError("Could not read the audio")

    monkeypatch.setattr(transcribe, "transcribe_file", broken)
    asyncio.run(transcripts.run(TID))
    assert env.db.rows[TID]["status"] == "failed"
    assert env.store["deleted"] == []  # kept for a retry or refund check


def test_run_gives_up_after_three_attempts(env, monkeypatch):
    env.db.rows[TID] = {"id": TID, "status": "transcribing", "upload_path": f"uploads/{TID}.mp3",
                        "file_name": "x.mp3", "speakers": False, "amount_kes": 15, "attempts": 3}

    async def must_not_run(*a):
        raise AssertionError("a fourth attempt must not reach Gemini")

    monkeypatch.setattr(transcribe, "transcribe_file", must_not_run)
    asyncio.run(transcripts.run(TID))
    row = env.db.rows[TID]
    assert row["status"] == "failed" and row["attempts"] == 4


# ---- real ffmpeg on crafted files -------------------------------------------------------

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def _make(tmp_path, name, *args):
    path = tmp_path / name
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args, str(path)], check=True)
    return str(path)


@needs_ffmpeg
def test_probe_reads_packets_not_the_header(tmp_path):
    # A WebM whose header claims 5 s around 60 s of sound.
    real = _make(tmp_path, "real.webm", "-f", "lavfi", "-i", "sine=duration=60", "-c:a", "libopus")
    data = bytearray(open(real, "rb").read())
    marker = data.find(bytes.fromhex("4489"))  # Matroska Duration element
    assert marker > 0
    size = data[marker + 2] & 0x7F
    data[marker + 3: marker + 3 + size] = struct.pack(">d" if size == 8 else ">f", 5000.0)  # 5 s, in ms
    fake = tmp_path / "fake.webm"
    fake.write_bytes(bytes(data))
    measured = asyncio.run(transcribe.probe(str(fake)))
    assert measured.audio and 59 < measured.seconds < 61


@needs_ffmpeg
def test_probe_finds_no_sound_in_a_silent_video(tmp_path):
    video = _make(tmp_path, "v.mp4", "-f", "lavfi", "-i", "color=size=64x64:duration=3", "-c:v", "mpeg4")
    assert asyncio.run(transcribe.probe(video)) == transcribe.Probe(None, audio=False)


@needs_ffmpeg
def test_probe_refuses_a_playlist_dressed_as_mp3(tmp_path):
    evil = tmp_path / "evil.mp3"
    evil.write_text("#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n")
    assert asyncio.run(transcribe.probe(str(evil))).seconds is None


@needs_ffmpeg
def test_split_stops_at_the_paid_length(tmp_path):
    src = _make(tmp_path, "long.mp3", "-f", "lavfi", "-i", "sine=duration=200", "-c:a", "libmp3lame")
    out = tmp_path / "parts"
    out.mkdir()
    parts = asyncio.run(transcribe.split(src, str(out), max_seconds=60))
    total = sum(asyncio.run(transcribe.probe(str(p))).seconds for p in parts)
    assert 59 < total < 61.5
