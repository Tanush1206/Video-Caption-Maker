import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.config import get_settings

# httpx logs every request at INFO, which buries the pipeline's own lines
# under hundreds of Hugging Face and ChromaDB round trips.
logging.getLogger("httpx").setLevel(logging.WARNING)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: place for DB connection warm-up, model preloading, etc.
    # (Whisper/embedding model loading happens in the Celery worker, not here,
    # so the API process stays lightweight and fast to start.)
    yield
    # Shutdown: place for cleanup (closing pools, etc.)


app = FastAPI(
    title="VideoCaptionMaker API",
    description="AI-powered video captioning & transcript search",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS: only allow the configured frontend origin(s). Never use "*" once
# credentials/cookies are involved (Milestone 2 auth).
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "VideoCaptionMaker API — see /docs for the interactive API explorer"}
