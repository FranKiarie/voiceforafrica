"""Transcription: pricing, reading model replies, fallback, documents, endpoints and the run."""

import asyncio
import json
import re
import shutil
import struct
import subprocess
import types

import httpx
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
    async def primary(client, audio, speakers, part):
        return [Segment(0, 1, "spk:0", "Habari")]

    async def fallback(*a):
        raise AssertionError("fallback must not run")

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    segs, models = _run(transcribe.transcribe_part(None, b"mp3", "sw", True))
    assert models == ["gemini-3.5-transcribe"] and segs[0].speaker == "Speaker 1"


def test_part_falls_back_when_transcribe_model_fails(monkeypatch):
    seen = []

    async def primary(*a):
        seen.append("primary")
        raise transcribe.TranscribeError("400 bad", retryable=False)

    async def fallback(client, audio, language, speakers, part):
        return [Segment(0, 1, "Speaker 1", "Habari")]

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    segs, models = _run(transcribe.transcribe_part(None, b"mp3", None, True))
    assert seen == ["primary"] and models == ["gemini-3.8-flash"] and segs[0].text == "Habari"


def test_part_falls_back_when_transcribe_model_hears_nothing(monkeypatch):
    async def primary(*a):
        return []

    async def fallback(*a):
        return []

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    assert _run(transcribe.transcribe_part(None, b"mp3", "en", False)) == ([], [])


def test_retryable_errors_are_retried_then_fall_back(monkeypatch):
    tries = []

    async def primary(*a):
        tries.append(1)
        raise transcribe.TranscribeError("429", retryable=True, wait=0)

    async def fallback(*a):
        return [Segment(0, 1, None, "ok")]

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    assert _run(transcribe.transcribe_part(None, b"mp3", None, False))[1] == ["gemini-3.8-flash"]
    assert len(tries) == transcribe.PRIMARY_ATTEMPTS


# ---- routing: which model reads a language first ----------------------------------------


def _models(monkeypatch, primary_says=None, fallback_says=None):
    """Fake models that record who was asked, in order."""
    asked = []

    async def primary(client, audio, speakers, part):
        asked.append("primary")
        if isinstance(primary_says, Exception):
            raise primary_says
        return list(primary_says or [Segment(0, 1, "spk:0", "main")])

    async def fallback(client, audio, language, speakers, part):
        asked.append("fallback")
        if isinstance(fallback_says, Exception):
            raise fallback_says
        return list(fallback_says if fallback_says is not None else [Segment(0, 1, "Speaker 1", "advanced")])

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    return asked


@pytest.mark.parametrize("language", ["en", "sw", "ha", "zu", None])
def test_main_languages_go_to_the_transcribe_model_first(monkeypatch, language):
    asked = _models(monkeypatch)
    assert _run(transcribe.transcribe_part(None, b"mp3", language, False))[1] == ["gemini-3.5-transcribe"]
    assert asked == ["primary"]


@pytest.mark.parametrize("language", ["am", "yo", "ki", "lg", "luo"])
def test_advanced_languages_go_to_the_advanced_model_first(monkeypatch, language):
    asked = _models(monkeypatch)
    assert _run(transcribe.transcribe_part(None, b"mp3", language, False))[1] == ["gemini-3.8-flash"]
    assert asked == ["fallback"]


def test_the_transcribe_model_is_never_told_the_language(monkeypatch):
    monkeypatch.setattr(transcribe, "_PACERS", {})
    sent = []

    class Client:
        async def post(self, url, json, headers):
            sent.append(json)
            return httpx.Response(200, json={"steps": [{"content": [{"type": "text", "text": "Selam"}]}]})

    for language in ("am", "sw", None):
        _run(transcribe._primary(Client(), b"mp3", False, 30))
    assert all(body["generation_config"]["transcription_config"]["language_codes"] == [] for body in sent)


def test_advanced_language_with_nothing_heard_asks_the_transcribe_model(monkeypatch):
    asked = _models(monkeypatch, fallback_says=[])
    segs, models = _run(transcribe.transcribe_part(None, b"mp3", "am", False))
    assert asked == ["fallback", "primary"] and models == ["gemini-3.5-transcribe"] and segs[0].text == "main"


def test_advanced_language_uses_the_transcribe_model_when_the_advanced_one_fails(monkeypatch):
    asked = _models(monkeypatch, fallback_says=transcribe.TranscribeError("400 bad"))
    assert _run(transcribe.transcribe_part(None, b"mp3", "ki", False))[1] == ["gemini-3.5-transcribe"]
    assert asked == ["fallback", "primary"]


def test_site_languages_match_the_server(monkeypatch):
    # src/data.ts marks the advanced-first languages; keep the two lists the same.
    import pathlib
    ts = (pathlib.Path(__file__).resolve().parents[2] / "src" / "data.ts").read_text()
    block = ts[ts.index("TRANSCRIBE_LANGUAGES"):]
    block = block[: block.index("];")]
    site = dict(re.findall(r'code: "(\w+)", label: "[^"]+"(, advanced: true)?', block))
    assert {code: (transcribe.ADVANCED if adv else transcribe.MAIN) for code, adv in site.items() if code} == {
        code: route for code, (_, route) in transcribe.LANGUAGES.items()
    }


# ---- pacing under the per-minute limits ---------------------------------------------------


class FakeTime:
    def __init__(self):
        self.now = 0.0

    def clock(self):
        return self.now

    async def sleep(self, seconds):
        self.now += seconds


def _windows_ok(sends, requests, tokens):
    """No 60 s span holds more than the limits."""
    for i, (start, _) in enumerate(sends):
        inside = [n for t, n in sends[i:] if t - start < 60]
        if len(inside) > requests or (tokens and sum(inside) > tokens):
            return False
    return True


def test_pacer_spaces_five_minute_parts_a_minute_apart():
    t = FakeTime()
    pace = transcribe.Pacer(10, 10_000, clock=t.clock, sleep=t.sleep)
    sends = []
    for _ in range(36):  # a 3-hour file
        _run(pace.wait(transcribe.audio_tokens(transcribe.PART_SECONDS)))
        sends.append((t.now, transcribe.audio_tokens(transcribe.PART_SECONDS)))
    assert _windows_ok(sends, 10, 10_000)
    # 7,500 audio tokens a part: one part a minute, so the last starts about 35 minutes in.
    assert 35 * 60 <= sends[-1][0] < 36 * 60


def test_pacer_holds_requests_under_the_request_limit():
    t = FakeTime()
    pace = transcribe.Pacer(10, clock=t.clock, sleep=t.sleep)
    sends = []
    for _ in range(30):
        _run(pace.wait(1_000))
        sends.append((t.now, 1))
    assert _windows_ok(sends, 9, None)
    assert sends[8][0] == 0 and sends[9][0] >= 60


def test_pacer_lets_a_lone_oversized_piece_through():
    t = FakeTime()
    pace = transcribe.Pacer(10, 10_000, clock=t.clock, sleep=t.sleep)
    _run(pace.wait(50_000))
    assert t.now == 0
    _run(pace.wait(100))
    assert t.now >= 60


def test_model_calls_wait_for_the_pacer(monkeypatch):
    waits = []

    class Pace:
        async def wait(self, tokens):
            waits.append(tokens)

    monkeypatch.setattr(transcribe, "_pacer", lambda model: Pace())

    class Client:
        async def post(self, url, json, headers):
            if "interactions" in url:
                return httpx.Response(200, json={"steps": []})
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "[]"}]}}]})

    _run(transcribe._primary(Client(), b"mp3", False, 300))
    _run(transcribe._fallback(Client(), b"mp3", "am", False, 120))
    assert waits == [transcribe.audio_tokens(300), transcribe.audio_tokens(120)]


def test_parts_are_five_minutes_and_fit_the_token_budget():
    assert transcribe.PART_SECONDS == 300
    assert transcribe.audio_tokens(transcribe.PART_SECONDS) <= 0.9 * 10_000


# ---- a refused piece is halved, never re-sent as it is ---------------------------------------


def test_parse_fallback_marks_refusals_as_blocked():
    with pytest.raises(transcribe.Blocked) as refused:
        transcribe.parse_fallback({"promptFeedback": {"blockReason": "OTHER"}}, 60)
    assert "OTHER" in str(refused.value) and not refused.value.retryable
    with pytest.raises(transcribe.Blocked):
        transcribe.parse_fallback({"candidates": [{"finishReason": "SAFETY"}]}, 60)


def _fake_halves(monkeypatch):
    """Pieces are byte strings naming their place, e.g. b"p" -> b"p0", b"p1"."""
    async def halves(audio, seconds):
        return [(audio + b"0", 0.0, seconds / 2), (audio + b"1", seconds / 2, seconds / 2)]

    monkeypatch.setattr(transcribe, "halves", halves)


def test_a_refused_part_is_halved_and_each_half_tried(monkeypatch):
    _fake_halves(monkeypatch)
    sent = []

    async def fallback(client, audio, language, speakers, seconds):
        sent.append(audio)
        if audio in (b"p", b"p0"):
            raise transcribe.Blocked("refused (OTHER)")
        return [Segment(1.0, 2.0, None, audio.decode())]

    monkeypatch.setattr(transcribe, "_fallback", fallback)
    segs, models = _run(transcribe.transcribe_part(None, b"p", "am", False, 300))
    # Each piece is sent once: the refused 300 s part, its refused first half, that half's halves, the second half.
    assert sent == [b"p", b"p0", b"p00", b"p01", b"p1"]
    assert [(s.start, s.text) for s in segs] == [(1.0, "p00"), (76.0, "p01"), (151.0, "p1")]
    assert models == ["gemini-3.8-flash"]


def test_a_piece_still_refused_at_the_floor_goes_to_the_transcribe_model(monkeypatch):
    _fake_halves(monkeypatch)
    asked = []

    async def fallback(client, audio, language, speakers, seconds):
        asked.append(("fallback", audio, seconds))
        raise transcribe.Blocked("refused (OTHER)")

    async def primary(client, audio, speakers, seconds):
        asked.append(("primary", audio, seconds))
        return [Segment(0.5, 1.0, "spk:0", audio.decode())]

    monkeypatch.setattr(transcribe, "_fallback", fallback)
    monkeypatch.setattr(transcribe, "_primary", primary)
    segs, models = _run(transcribe.transcribe_part(None, b"p", "yo", False, 300))
    # 300 -> 150 -> 75 s; 75 s is not halved again (37.5 s < the 60 s floor).
    assert [a[1] for a in asked if a[0] == "fallback"] == [b"p", b"p0", b"p00", b"p01", b"p1", b"p10", b"p11"]
    assert [(a[1], a[2]) for a in asked if a[0] == "primary"] == [(b"p00", 75), (b"p01", 75), (b"p10", 75), (b"p11", 75)]
    assert [s.start for s in segs] == [0.5, 75.5, 150.5, 225.5]
    assert models == ["gemini-3.5-transcribe"]


def test_a_piece_neither_model_can_read_is_marked_not_failed(monkeypatch):
    _fake_halves(monkeypatch)

    async def fallback(client, audio, language, speakers, seconds):
        if audio == b"p1":
            return [Segment(0, 2, None, "sawa")]
        raise transcribe.Blocked("refused (OTHER)")

    async def primary(*a):
        return []

    monkeypatch.setattr(transcribe, "_fallback", fallback)
    monkeypatch.setattr(transcribe, "_primary", primary)
    segs, _ = _run(transcribe.transcribe_part(None, b"p", "luo", False, 300))
    assert [(s.start, s.end, s.text) for s in segs] == [
        (0.0, 75.0, transcribe.NOT_TRANSCRIBED), (75.0, 150.0, transcribe.NOT_TRANSCRIBED), (150.0, 152.0, "sawa"),
    ]
    assert transcribe.word_count(segs) == 1


def test_a_short_refused_piece_is_not_halved(monkeypatch):
    async def halves(*a):
        raise AssertionError("a 90 s piece is under twice the floor")

    async def fallback(*a):
        raise transcribe.Blocked("refused (OTHER)")

    async def primary(client, audio, speakers, seconds):
        return [Segment(0, 1, None, "ok")]

    monkeypatch.setattr(transcribe, "halves", halves)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    monkeypatch.setattr(transcribe, "_primary", primary)
    assert _run(transcribe.transcribe_part(None, b"p", "am", False, 90))[0][0].text == "ok"


def test_a_refused_piece_that_cannot_be_halved_goes_to_the_transcribe_model(monkeypatch):
    async def halves(*a):
        raise transcribe.TranscribeError("Could not halve a piece")

    async def fallback(*a):
        raise transcribe.Blocked("refused (OTHER)")

    async def primary(client, audio, speakers, seconds):
        return [Segment(0, 1, None, "ok")]

    monkeypatch.setattr(transcribe, "halves", halves)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    monkeypatch.setattr(transcribe, "_primary", primary)
    assert _run(transcribe.transcribe_part(None, b"p", "am", False, 300))[0][0].text == "ok"


def test_a_main_language_part_the_transcribe_model_fails_is_also_split(monkeypatch):
    _fake_halves(monkeypatch)
    sent = []

    async def primary(client, audio, speakers, seconds):
        if audio == b"p":
            raise transcribe.TranscribeError("500", retryable=False)
        return [Segment(0, 1, None, "main " + audio.decode())]

    async def fallback(client, audio, language, speakers, seconds):
        sent.append(audio)
        if audio == b"p":
            raise transcribe.Blocked("refused (OTHER)")
        return [Segment(0, 1, None, audio.decode())]

    monkeypatch.setattr(transcribe, "_primary", primary)
    monkeypatch.setattr(transcribe, "_fallback", fallback)
    segs, models = _run(transcribe.transcribe_part(None, b"p", "sw", False, 300))
    assert sent == [b"p", b"p0", b"p1"] and [s.text for s in segs] == ["p0", "p1"]
    assert models == ["gemini-3.8-flash"]


def test_other_advanced_model_errors_still_fail_a_main_language_part(monkeypatch):
    _models(monkeypatch, primary_says=transcribe.TranscribeError("500"), fallback_says=transcribe.TranscribeError("403 key"))
    with pytest.raises(transcribe.TranscribeError, match="403"):
        _run(transcribe.transcribe_part(None, b"mp3", "sw", False))


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


@needs_ffmpeg
def test_split_cuts_five_minute_parts(tmp_path):
    src = _make(tmp_path, "long.mp3", "-f", "lavfi", "-i", "sine=duration=650", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "32k")
    out = tmp_path / "parts"
    out.mkdir()
    parts = asyncio.run(transcribe.split(src, str(out), max_seconds=3600))
    lengths = [asyncio.run(transcribe.probe(str(p))).seconds for p in parts]
    assert len(parts) == 3 and all(299 < n < 301.5 for n in lengths[:2]) and 49 < lengths[2] < 51


@needs_ffmpeg
def test_halves_keep_all_the_sound_in_order(tmp_path):
    src = _make(tmp_path, "piece.mp3", "-f", "lavfi", "-i", "sine=duration=300", "-ac", "1", "-ar", "16000",
                "-c:a", "libmp3lame", "-b:a", "32k")
    (first, start1, len1), (second, start2, len2) = asyncio.run(transcribe.halves(open(src, "rb").read(), 300))
    assert start1 == 0 and 149 < len1 < 151 and start2 == len1 and 299 < len1 + len2 < 301
    assert first and second


def test_transcribe_file_times_parts_from_the_recording_start(monkeypatch, tmp_path):
    monkeypatch.setattr(transcribe.settings, "google_ai_api_key", "test")
    parts = []
    for n in range(3):
        path = tmp_path / f"part{n:03d}.mp3"
        path.write_bytes(b"mp3")
        parts.append(path)

    async def split(url, out_dir, max_seconds):
        return parts

    async def probe(url):
        return transcribe.Probe(300.0 if not url.endswith("part002.mp3") else 50.0)

    async def part(client, audio, language, speakers, seconds):
        return [Segment(1.0, 2.0, None, "x")], ["gemini-3.5-transcribe"]

    monkeypatch.setattr(transcribe, "split", split)
    monkeypatch.setattr(transcribe, "probe", probe)
    monkeypatch.setattr(transcribe, "transcribe_part", part)
    segs, models = asyncio.run(transcribe.transcribe_file("https://x", "sw", False, 650))
    assert [s.start for s in segs] == [1.0, 301.0, 601.0] and models == ["gemini-3.5-transcribe"] * 3

