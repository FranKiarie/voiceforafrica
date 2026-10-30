import asyncio
import json
import re
from pathlib import Path

import httpx
import pytest

from app import translate


def _reply(already: bool, text: str) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": json.dumps({"already": already, "text": text})}]}}]}


@pytest.fixture
def gemini(monkeypatch):
    calls: list[dict] = []
    replies: list[httpx.Response] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return replies.pop(0)

    monkeypatch.setattr(translate, "_new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(translate, "_done", type(translate._done)())
    return calls, replies


def test_translates_into_the_chosen_language(gemini):
    calls, replies = gemini
    replies.append(httpx.Response(200, json=_reply(False, "  Karibu Kilima Grove Hotel.  ")))
    assert asyncio.run(translate.for_language("Welcome to Kilima Grove Hotel.", "sw")) == ("Karibu Kilima Grove Hotel.", True)
    prompt = calls[0]["systemInstruction"]["parts"][0]["text"]
    assert "Kiswahili (Swahili)" in prompt
    assert calls[0]["contents"][0]["parts"][0]["text"] == "Welcome to Kilima Grove Hotel."


def test_a_script_already_in_the_language_is_kept_word_for_word(gemini):
    _, replies = gemini
    replies.append(httpx.Response(200, json=_reply(True, "Karibu Kilima Grove hotel")))
    script = "Karibu Kilima Grove Hotel."
    assert asyncio.run(translate.for_language(script, "sw")) == (script, False)


def test_the_same_script_is_translated_once(gemini):
    calls, replies = gemini
    replies.append(httpx.Response(200, json=_reply(False, "Sannu.")))
    first = asyncio.run(translate.for_language("Hello there.", "ha"))
    assert asyncio.run(translate.for_language("Hello there.", "ha")) == first
    assert len(calls) == 1


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(429, json={"error": {"message": "quota"}}),
        httpx.Response(200, json={"candidates": []}),
        httpx.Response(200, json=_reply(False, "   ")),
    ],
)
def test_failures_raise(gemini, response):
    _, replies = gemini
    replies.append(response)
    with pytest.raises(translate.TranslateError):
        asyncio.run(translate.for_language("Hello there.", "sw"))
    assert translate._done == {}


def _checked(already: bool) -> dict:
    return {"candidates": [{"content": {"parts": [{"text": json.dumps({"already": already})}]}}]}


def test_a_write_in_language_is_checked_never_translated(gemini):
    calls, replies = gemini
    replies.append(httpx.Response(200, json=_checked(True)))
    script = "Ũkaribũ Kilima Grove Hotel."
    assert asyncio.run(translate.for_language(script, "ki")) == (script, False)
    prompt = calls[0]["systemInstruction"]["parts"][0]["text"]
    assert "Gĩkũyũ (Kikuyu)" in prompt and "translate" not in prompt
    assert set(calls[0]["generationConfig"]["responseSchema"]["properties"]) == {"already"}


def test_a_write_in_language_refuses_a_script_in_another_language(gemini):
    _, replies = gemini
    replies.append(httpx.Response(200, json=_checked(False)))
    with pytest.raises(translate.NotInLanguage):
        asyncio.run(translate.for_language("Welcome to Kilima Grove Hotel.", "rw"))
    assert translate._done == {}


def test_a_write_in_check_that_fails_reads_the_script_as_written(gemini):
    _, replies = gemini
    replies.append(httpx.Response(429, json={"error": {"message": "quota"}}))
    assert asyncio.run(translate.for_language("Mbote na bino.", "ln")) == ("Mbote na bino.", False)
    assert translate._done == {}


def test_write_in_languages_are_on_the_site():
    assert set(translate.WRITE_IN) <= set(translate.LANGUAGE_NAMES)


def test_every_language_on_the_site_has_a_name():
    data = (Path(__file__).resolve().parents[2] / "src" / "data.ts").read_text(encoding="utf-8")
    listed = data.split("export const LANGUAGES")[1].split("];")[0]
    assert set(re.findall(r'code: "([a-z]{2,3})"', listed)) == set(translate.LANGUAGE_NAMES)


def test_the_site_marks_exactly_the_write_in_languages():
    data = (Path(__file__).resolve().parents[2] / "src" / "data.ts").read_text(encoding="utf-8")
    listed = data.split("export const LANGUAGES")[1].split("];")[0]
    assert set(re.findall(r'code: "([a-z]{2,3})"[^}]*writeIn: true', listed)) == set(translate.WRITE_IN)
