from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db, jobs, transcripts
from .config import settings
from .routes_payments import router as payments_router
from .routes_public import router as public_router
from .routes_transcripts import router as transcripts_router


def cors_origins(raw: str) -> list[str]:
    """Explicit http(s) origins only: a "*" next to allow_credentials would let any site call us."""
    origins = []
    for origin in (o.strip().rstrip("/") for o in (raw or "").split(",")):
        if origin and origin != "*" and origin.startswith(("https://", "http://")) and "*" not in origin:
            origins.append(origin)
    return origins


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Paid clips interrupted by a restart or deploy pick up where they left off.
    jobs.spawn(jobs.resume_stuck_jobs(startup=True))
    jobs.spawn(transcripts.resume_stuck(startup=True))
    yield
    await db.aclose()


app = FastAPI(title="Mikaka Voice API", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(settings.allowed_origins),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(public_router, prefix="/api/v1/voice-studio")
app.include_router(payments_router, prefix="/api/v1/voice-studio")
app.include_router(transcripts_router, prefix="/api/v1/voice-studio")


@app.get("/health")
async def health() -> dict:
    # Booleans only: whether each service is configured, never a key or URL.
    return {
        "ok": True,
        "tts": bool(settings.google_ai_api_key),
        "payments": bool(settings.paystack_secret_key),
        "database": bool(settings.supabase_url and settings.supabase_service_key),
    }
