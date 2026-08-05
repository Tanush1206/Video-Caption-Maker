from fastapi import APIRouter

from app.api import auth

api_router = APIRouter(prefix="/api")


@api_router.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    """Liveness check — used by Docker healthchecks and the verification plan."""
    return {"status": "healthy"}


api_router.include_router(auth.router, prefix="/auth", tags=["auth"])

# Milestone 3+: videos, captions, and search sub-routers get included here.
