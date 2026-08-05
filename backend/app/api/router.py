from fastapi import APIRouter

api_router = APIRouter(prefix="/api")


@api_router.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    """Liveness check — used by Docker healthchecks and the verification plan."""
    return {"status": "healthy"}


# Milestone 2+: auth, videos, captions, search sub-routers get included here, e.g.
# from app.api import auth
# api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
