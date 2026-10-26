"""Voices and voice-over types.

The site only ever sees the public voice id (an African first name); the Google
library voice behind it stays on the server. Mirrors VOICES and PURPOSES in
src/data.ts.
"""

from __future__ import annotations

# public id -> (display name, Google voice). Every name matches where its voice
# comes from. Library voices exist for Kenya, South Africa and Egypt; designed
# voices (voice_...) cover the other countries and expire a year after creation.
VOICES: dict[str, tuple[str, str]] = {
    # Kenya (library, sw-KE)
    "wanjiru": ("Wanjiru", "sw-ke-csagent-4"),
    "nyokabi": ("Nyokabi", "sw-ke-advisor-1"),
    "makena": ("Makena", "sw-ke-training-1"),
    "akinyi": ("Akinyi", "sw-ke-tutor-4"),
    "chebet": ("Chebet", "sw-ke-advisor-6"),
    "njeri": ("Njeri", "sw-ke-training-3"),
    "atieno": ("Atieno", "sw-ke-tutor-5"),
    "zawadi": ("Zawadi", "sw-ke-assistant-5"),
    "kamau": ("Kamau", "sw-ke-tutor-3"),
    "onyango": ("Onyango", "sw-ke-advisor-2"),
    # Listed as female by Google, but it sounds male.
    "baraka": ("Baraka", "sw-ke-advisor-4"),
    "kiprono": ("Kiprono", "sw-ke-training-2"),
    "mwangi": ("Mwangi", "sw-ke-tutor-8"),
    "mutua": ("Mutua", "sw-ke-training-5"),
    "jabari": ("Jabari", "sw-ke-tutor-2"),
    "kibet": ("Kibet", "sw-ke-concierge-4"),
    "omondi": ("Omondi", "sw-ke-csagent-8"),
    "otieno": ("Otieno", "sw-ke-assistant-2"),
    # South Africa (library, en-ZA, Cape Town English)
    "thandiwe": ("Thandiwe", "en-za-storyteller-2"),
    "lerato": ("Lerato", "en-za-commercial-3"),
    "naledi": ("Naledi", "en-za-training-6"),
    "thabo": ("Thabo", "en-za-storyteller-1"),
    "sipho": ("Sipho", "en-za-commercial-4"),
    "bongani": ("Bongani", "en-za-podcaster-2"),
    # Egypt (library, ar-EG)
    "nour": ("Nour", "ar-eg-podcaster-4"),
    "mariam": ("Mariam", "ar-eg-storyteller-11"),
    "omar": ("Omar", "ar-eg-podcaster-3"),
    "karim": ("Karim", "ar-eg-commercial-1"),
}

# Names used for a few hours on 2026-10-27, before every name matched its
# voice's origin. Ids that were reused for another country are not listed.
_RENAMED = {
    "amara": "wanjiru", "folake": "chebet", "ngozi": "atieno", "adwoa": "baraka",
    "kofi": "baraka", "sekou": "mwangi", "chidi": "kibet",
}

# Jobs created before any names were introduced stored the Google voice itself.
_LEGACY_PREFIX = "sw-ke-"
_PUBLIC_BY_GOOGLE = {google: public for public, (_, google) in VOICES.items()}

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


def public_voice_id(voice_id: str) -> str | None:
    """The catalogue id for a request's voice, or None when it is not offered.

    Pages loaded before a rename still send an older id (or the library id);
    those are translated rather than refused.
    """
    voice_id = (voice_id or "").strip()
    if voice_id in VOICES:
        return voice_id
    if voice_id in _RENAMED:
        return _RENAMED[voice_id]
    return _PUBLIC_BY_GOOGLE.get(voice_id)


def google_voice(voice_id: str) -> str:
    """The Google voice to synthesise with; legacy jobs may already hold one."""
    public = public_voice_id(voice_id)
    if public:
        return VOICES[public][1]
    if voice_id.startswith(_LEGACY_PREFIX):
        return voice_id
    raise KeyError(voice_id)


def voice_name(voice_id: str) -> str:
    public = public_voice_id(voice_id)
    return VOICES[public][0] if public else "Kenyan voice"


def purpose_or_default(purpose: str | None) -> str:
    value = (purpose or "").strip().lower()
    return value if value in PURPOSES else DEFAULT_PURPOSE


def purpose_style(purpose: str | None) -> str:
    return PURPOSES[purpose_or_default(purpose)][1]
