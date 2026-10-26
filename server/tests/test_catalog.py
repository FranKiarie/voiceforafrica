import pytest

from app import catalog


def test_every_voice_maps_to_a_kenyan_library_voice():
    assert len(catalog.VOICES) == 18
    for public_id, (name, google) in catalog.VOICES.items():
        assert public_id == name.lower()
        assert google.startswith("sw-ke-")
    assert len({g for _, g in catalog.VOICES.values()}) == 18


def test_google_voice_masks_and_keeps_legacy_jobs_working():
    assert catalog.google_voice("kwame") == "sw-ke-tutor-3"
    assert catalog.google_voice("sw-ke-training-6") == "sw-ke-training-6"
    with pytest.raises(KeyError):
        catalog.google_voice("puck")


def test_voice_name_for_public_and_legacy_ids():
    assert catalog.voice_name("thabo") == "Thabo"
    assert catalog.voice_name("sw-ke-csagent-4") == "Amara"
    assert catalog.voice_name("sw-ke-training-6") == "Kenyan voice"


def test_purpose_style_defaults_to_general():
    general = catalog.PURPOSES["general"][1]
    assert catalog.purpose_style(None) == general
    assert catalog.purpose_style("  RADIO-AD ") == catalog.PURPOSES["radio-ad"][1]
    assert catalog.purpose_style("unknown") == general
    assert all(len(style) <= 120 for _, style in catalog.PURPOSES.values())
