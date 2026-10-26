import pytest

from app import catalog

LIBRARY_PREFIXES = ("sw-ke-", "en-za-", "ar-eg-")


def test_every_voice_has_a_distinct_google_voice():
    googles = [google for _, google in catalog.VOICES.values()]
    assert len(googles) == len(set(googles))
    for public_id, (name, google) in catalog.VOICES.items():
        assert public_id == name.lower()
        assert google.startswith(LIBRARY_PREFIXES) or google.startswith("voice_")


def test_names_match_the_voice_origin():
    assert catalog.VOICES["thandiwe"][1].startswith("en-za-")
    assert catalog.VOICES["wanjiru"][1].startswith("sw-ke-")
    assert catalog.VOICES["omar"][1].startswith("ar-eg-")


def test_google_voice_masks_and_keeps_old_jobs_working():
    assert catalog.google_voice("kamau") == "sw-ke-tutor-3"
    assert catalog.google_voice("amara") == "sw-ke-csagent-4"
    assert catalog.google_voice("sw-ke-training-7") == "sw-ke-training-7"
    with pytest.raises(KeyError):
        catalog.google_voice("puck")


def test_public_voice_id_translates_old_ids_only():
    assert catalog.public_voice_id("sw-ke-advisor-4") == "baraka"
    assert catalog.public_voice_id("adwoa") == "baraka"
    assert catalog.public_voice_id("sw-ke-training-7") is None
    assert catalog.public_voice_id("puck") is None


def test_voice_name_for_public_and_legacy_ids():
    assert catalog.voice_name("thabo") == "Thabo"
    assert catalog.voice_name("sw-ke-csagent-4") == "Wanjiru"
    assert catalog.voice_name("sw-ke-training-7") == "Kenyan voice"


def test_purpose_style_defaults_to_general():
    general = catalog.PURPOSES["general"][1]
    assert catalog.purpose_style(None) == general
    assert catalog.purpose_style("  RADIO-AD ") == catalog.PURPOSES["radio-ad"][1]
    assert catalog.purpose_style("unknown") == general
    assert all(len(style) <= 120 for _, style in catalog.PURPOSES.values())
