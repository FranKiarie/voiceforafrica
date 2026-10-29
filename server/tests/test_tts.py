import asyncio
import base64
import json

import httpx
import pytest

from app import tts


def _sse(*events: dict) -> bytes:
    return "".join(f"data: {json.dumps(e)}\n\n" for e in events).encode()


def _audio(pcm: bytes) -> dict:
    return {"event_type": "step.delta",
            "delta": {"type": "audio", "mime_type": "audio/l16", "data": base64.b64encode(pcm).decode()}}


@pytest.fixture
def keyed(monkeypatch):
    monkeypatch.setattr(tts.settings, "google_ai_api_key", "test-key")
    monkeypatch.setattr(tts, "_BACKOFF_SECONDS", (0.0, 0.0))


def _mock_client(monkeypatch, handler):
    monkeypatch.setattr(tts, "_new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


# preview_text

def test_preview_short_script_returned_whole():
    script = "Habari. " * 80  # 640 chars, under 45 s
    assert tts.preview_text(script) == script.strip()


def test_preview_long_script_stops_at_first_sentence_past_45s():
    sentence = "This sentence is exactly fifty characters long ok."  # 50 chars
    script = " ".join([sentence] * 40)
    out = tts.preview_text(script)
    assert out.endswith(".")
    assert 675 <= len(out) <= 900
    assert len(out) - len(sentence) - 1 < 675  # shortest run


def test_preview_cap_cuts_at_last_space_without_sentence_end():
    script = " ".join(["neno"] * 400)  # no punctuation
    out = tts.preview_text(script)
    assert len(out) <= 900
    assert not out.endswith(" ")
    assert script.startswith(out)
    assert script[len(out)] == " "


def test_preview_cap_when_only_sentence_end_is_far():
    script = "Short start. " + " ".join(["neno"] * 400) + "."
    out = tts.preview_text(script)
    assert len(out) <= 900 and len(out) > 675


# chunk_text

def test_chunk_text_respects_limit_and_keeps_words():
    text = " ".join(f"Sentence number {i} is here." for i in range(300))
    chunks = tts.chunk_text(text, max_chars=200)
    assert all(len(c) <= 200 for c in chunks)
    assert " ".join(chunks).split() == text.split()
    assert all(c.endswith(".") for c in chunks)


def test_chunk_text_splits_long_sentence_on_words():
    text = " ".join(["word"] * 1000)
    chunks = tts.chunk_text(text, max_chars=1500)
    assert len(chunks) > 1
    assert all(len(c) <= 1500 for c in chunks)
    assert " ".join(chunks) == text


def test_chunk_text_short_is_single_chunk():
    assert tts.chunk_text("Habari yako. Karibu!") == ["Habari yako. Karibu!"]


# encode / seconds / model

def test_encode_mp3_silence():
    mp3 = tts.encode_mp3(b"\x00\x00" * 24000)
    assert mp3[:3] == b"ID3" or (mp3[0] == 0xFF and (mp3[1] & 0xE0) == 0xE0)
    assert tts.pcm_seconds(b"\x00\x00" * 24000) == 1


def test_pick_model(monkeypatch):
    assert tts.pick_model("sw") == "gemini-3.8-flash-tts"
    assert tts.pick_model("en") == tts.settings.tts_model_premium
    monkeypatch.setattr(tts.settings, "tts_model_premium", "gemini-3.8-flash-lite-tts")
    for lang in ("sw", "sw-KE", "ig", "ti", "st"):
        assert tts.pick_model(lang) == "gemini-3.8-flash-tts"
    assert tts.pick_model("en") == "gemini-3.8-flash-lite-tts"


# synthesize_pcm

def test_synthesize_pcm_streams_two_deltas(keyed, monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        body = _sse(_audio(b"\x01\x00\x02\x00"), _audio(b"\x03\x00"), {"event_type": "interaction.completed"})
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    _mock_client(monkeypatch, handler)
    pcm = asyncio.run(tts.synthesize_pcm("Habari yako.", "sw-ke-csagent-4", "gemini-3.8-flash-tts"))
    assert pcm == b"\x01\x00\x02\x00\x03\x00"
    assert seen["key"] == "test-key"
    assert seen["body"]["model"] == "gemini-3.8-flash-tts"
    assert seen["body"]["generation_config"]["speech_config"][0]["voice"] == "sw-ke-csagent-4"
    assert seen["body"]["input"][0]["content"][0]["annotations"][0]["style"] == tts.build_speech_style()


def test_synthesize_pcm_retries_5xx(keyed, monkeypatch):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503, json={"error": {"message": "busy"}})
        return httpx.Response(200, content=_sse(_audio(b"\x05\x00"), {"event_type": "interaction.completed"}))

    _mock_client(monkeypatch, handler)
    assert asyncio.run(tts.synthesize_pcm("Hi.", "v", "m")) == b"\x05\x00"
    assert calls["n"] == 2


def test_synthesize_pcm_requires_completion(keyed, monkeypatch):
    _mock_client(monkeypatch, lambda r: httpx.Response(200, content=_sse(_audio(b"\x05\x00"))))
    with pytest.raises(tts.TtsError) as err:
        asyncio.run(tts.synthesize_pcm("Hi.", "v", "m"))
    assert err.value.retryable


def test_synthesize_pcm_400_not_retried_and_hides_key(keyed, monkeypatch):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(400, json={"error": {"message": "bad voice " + "x" * 1000}})

    _mock_client(monkeypatch, handler)
    with pytest.raises(tts.TtsError) as err:
        asyncio.run(tts.synthesize_pcm("Hi.", "v", "m"))
    assert not err.value.retryable
    assert calls["n"] == 1
    assert len(str(err.value)) <= 400 and "test-key" not in str(err.value)


def test_synthesize_pcm_unconfigured(monkeypatch):
    monkeypatch.setattr(tts.settings, "google_ai_api_key", "")
    with pytest.raises(tts.TtsError, match="not configured") as err:
        asyncio.run(tts.synthesize_pcm("Hi.", "v", "m"))
    assert not err.value.retryable


def test_error_message_echoing_key_is_redacted(keyed, monkeypatch):
    monkeypatch.setattr(tts.settings, "google_ai_api_key", "AIzaSyTESTKEY0123456789abcdefgh")
    _mock_client(monkeypatch, lambda r: httpx.Response(
        400, json={"error": {"message": "API key AIzaSyTESTKEY0123456789abcdefgh not valid"}}))
    with pytest.raises(tts.TtsError) as err:
        asyncio.run(tts.synthesize_pcm("Hi.", "v", "m"))
    assert "AIzaSyTESTKEY" not in str(err.value) and "[redacted]" in str(err.value)


def test_preview_text_never_empty_and_keeps_whole_words():
    assert tts.preview_text("x" * 2000) == "x" * 900  # one giant word: hard cut
    script = "\n".join(["neno"] * 400)  # newlines, no spaces
    out = tts.preview_text(script)
    assert out and script.startswith(out) and script[len(out)] == "\n"
    script = ("abcd " * 180) + "tail " * 100  # char 900 is a space: keep the last full word
    assert tts.preview_text(script) == ("abcd " * 180).strip()


def test_render_mp3_uses_the_library_voice_and_purpose(keyed, monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        body = _sse(_audio(b"\x01\x00" * 2400), {"event_type": "interaction.completed"})
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    _mock_client(monkeypatch, handler)
    mp3, _ = asyncio.run(tts.render_mp3("Habari yako.", "kamau", "sw", "documentary"))
    assert mp3
    assert seen["body"]["generation_config"]["speech_config"][0]["voice"] == "sw-ke-tutor-3"
    style = seen["body"]["input"][0]["content"][0]["annotations"][0]["style"]
    assert style.startswith("Documentary narration")
