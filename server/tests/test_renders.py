import asyncio

import pytest

from app import db, renders, tts


@pytest.fixture
def store(monkeypatch):
    state = {"files": {}, "rows": {}, "renders": []}

    async def select_one(table, params):
        key = params["cache_key"].removeprefix("eq.")
        return state["rows"].get(key)

    async def insert(table, row, ignore_duplicates=False):
        state["rows"].setdefault(row["cache_key"], {"storage_path": row["storage_path"], "seconds": row["seconds"]})
        return row

    async def upload(path, data, content_type="audio/mpeg"):
        state["files"][path] = data

    async def download(path):
        return state["files"][path]

    async def render_mp3(text, voice_id, language, purpose=None):
        state["renders"].append(text)
        return f"<{text}>".encode(), len(text) / 10

    for name, fn in {"select_one": select_one, "insert": insert, "upload": upload, "download": download}.items():
        monkeypatch.setattr(db, name, fn)
    monkeypatch.setattr(tts, "render_mp3", render_mp3)
    monkeypatch.setattr(tts, "preview_text", lambda s: s.split(". ")[0] + "." if ". " in s else s)
    return state


def test_render_bytes_makes_once_then_reuses(store):
    a = asyncio.run(renders.render_bytes("Karibu sana.", "wanjiru", "sw", "general"))
    b = asyncio.run(renders.render_bytes("Karibu sana.", "wanjiru", "sw", "general"))
    assert a == b == (b"<Karibu sana.>", 1)
    assert store["renders"] == ["Karibu sana."]


def test_paid_render_reuses_the_preview_and_renders_only_the_rest(store):
    script = "Karibu sana. Leo tuna ofa kubwa kwa wateja wote."
    asyncio.run(renders.render_bytes("Karibu sana.", "wanjiru", "sw", "radio-ad"))  # the preview
    audio, seconds = asyncio.run(renders.render_script(script, "wanjiru", "sw", "radio-ad"))
    assert store["renders"] == ["Karibu sana.", "Leo tuna ofa kubwa kwa wateja wote."]
    assert audio == b"<Karibu sana.><Leo tuna ofa kubwa kwa wateja wote.>"
    assert seconds == 1 + 4


def test_short_script_paid_render_makes_nothing_new(store):
    asyncio.run(renders.render_bytes("Karibu sana", "kamau", "en", "general"))
    asyncio.run(renders.render_script("Karibu sana", "kamau", "en", "general"))
    assert store["renders"] == ["Karibu sana"]


def test_cache_outage_still_renders(store, monkeypatch):
    async def down(*a, **k):
        raise db.DbError("down", 503)

    monkeypatch.setattr(db, "select_one", down)
    monkeypatch.setattr(db, "upload", down)
    monkeypatch.setattr(db, "insert", down)
    assert asyncio.run(renders.render_bytes("Habari.", "wanjiru", "sw", None)) == (b"<Habari.>", 1)
