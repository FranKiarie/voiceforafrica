"""Voices and voice-over types.

The site only ever sees the public voice id (an African first name); the Google
library voice behind it stays on the server. Mirrors VOICES and PURPOSES in
src/data.ts.
"""

from __future__ import annotations

# public id -> (display name, Google library voice)
VOICES: dict[str, tuple[str, str]] = {
    "amara": ("Amara", "sw-ke-csagent-4"),
    "naledi": ("Naledi", "sw-ke-training-1"),
    "akinyi": ("Akinyi", "sw-ke-tutor-4"),
    "thandiwe": ("Thandiwe", "sw-ke-advisor-1"),
    "adwoa": ("Adwoa", "sw-ke-advisor-4"),
    "folake": ("Folake", "sw-ke-advisor-6"),
    "selam": ("Selam", "sw-ke-training-3"),
    "ngozi": ("Ngozi", "sw-ke-tutor-5"),
    "zawadi": ("Zawadi", "sw-ke-assistant-5"),
    "kwame": ("Kwame", "sw-ke-tutor-3"),
    "thabo": ("Thabo", "sw-ke-advisor-2"),
    "abebe": ("Abebe", "sw-ke-training-2"),
    "jabari": ("Jabari", "sw-ke-tutor-2"),
    "sekou": ("Sekou", "sw-ke-tutor-8"),
    "chidi": ("Chidi", "sw-ke-concierge-4"),
    "tendai": ("Tendai", "sw-ke-csagent-8"),
    "otieno": ("Otieno", "sw-ke-assistant-2"),
    "bongani": ("Bongani", "sw-ke-training-5"),
}

# Jobs created before the names were introduced stored the Google voice itself.
_LEGACY_PREFIX = "sw-ke-"
_BY_GOOGLE = {google: name for name, google in VOICES.values()}

# public id -> (label, delivery note for the speech model). Notes stay short:
# long style text competes with the voice and makes it drift.
PURPOSES: dict[str, tuple[str, str]] = {
    "general": ("General voice-over", "Warm, friendly, lively; clear, natural pace; conversational."),
    "radio-ad": ("Radio ad", "Upbeat radio advert: bright, smiling energy; punchy and persuasive; lean on the offer."),
    "commercial": ("TV or online ad", "Polished commercial voice-over: confident, warm and persuasive; crisp delivery."),
    "documentary": ("Documentary", "Documentary narration: calm, measured and authoritative; warm, unhurried, natural pauses."),
    "explainer": ("Corporate or explainer video", "Professional explainer: clear, friendly and confident; steady pace."),
    "training": ("Training or e-learning", "Patient teacher: clear, encouraging and steady; easy to follow."),
    "story": ("Audiobook or story", "Expressive storyteller: warm and engaging; varied pace, gentle drama."),
    "news": ("News read", "Newsreader: neutral, crisp and authoritative; even pace."),
    "podcast": ("Podcast intro or outro", "Relaxed podcast host: conversational, upbeat and friendly."),
    "phone": ("Phone menu or on-hold message", "Phone announcer: calm, polite and clear; slightly slow, every word distinct."),
    "social": ("Social media video", "Social media creator: energetic, casual and fun; quick, lively pace."),
    "announcement": ("Event or public announcement", "Public announcer: clear, projected and warm; measured pace."),
}
DEFAULT_PURPOSE = "general"


def is_voice(voice_id: str) -> bool:
    return voice_id in VOICES


def google_voice(voice_id: str) -> str:
    """The library voice to synthesise with; legacy jobs already hold one."""
    if voice_id in VOICES:
        return VOICES[voice_id][1]
    if voice_id.startswith(_LEGACY_PREFIX):
        return voice_id
    raise KeyError(voice_id)


def voice_name(voice_id: str) -> str:
    if voice_id in VOICES:
        return VOICES[voice_id][0]
    return _BY_GOOGLE.get(voice_id, "Kenyan voice")


def purpose_or_default(purpose: str | None) -> str:
    value = (purpose or "").strip().lower()
    return value if value in PURPOSES else DEFAULT_PURPOSE


def purpose_style(purpose: str | None) -> str:
    return PURPOSES[purpose_or_default(purpose)][1]
