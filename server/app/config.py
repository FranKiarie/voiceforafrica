from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_anon_key: str = ""
    storage_bucket: str = "voice-audio"

    google_ai_api_key: str = ""
    # Premium for pay as you go and Swahili; Standard is for plan minutes later.
    tts_model_premium: str = "gemini-3.8-flash-tts"
    tts_model_standard: str = "gemini-3.8-flash-lite-tts"
    tts_timeout_seconds: float = 30.0
    # Transcription: the affordable speech-to-text model first; the advanced
    # general model takes over a part the first one cannot do.
    transcribe_model: str = "gemini-3.5-transcribe"
    transcribe_fallback_model: str = "gemini-3.8-flash"
    # Private Cloud Storage bucket for customers' audio (deleted after a day).
    upload_bucket: str = "mikakavoice-uploads"
    # This service's own public URL; long transcriptions ping it so Cloud Run keeps the instance.
    self_url: str = ""

    paystack_secret_key: str = ""

    public_site_url: str = "https://voice.mikaka.io"
    allowed_origins: str = "https://voice.mikaka.io"

    previews_per_day: int = 3
    # 0 on Fly (its edge sets Fly-Client-IP). On Cloud Run, the caller's address
    # is this many entries from the right of X-Forwarded-For.
    forwarded_for_hops: int = 0


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
