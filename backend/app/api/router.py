from fastapi import APIRouter

from app.api import auth, caption_styles, captions, videos

api_router = APIRouter(prefix="/api")


@api_router.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    """Liveness check — used by Docker healthchecks and the verification plan."""
    return {"status": "healthy"}


api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(videos.router, prefix="/videos", tags=["videos"])
api_router.include_router(captions.router, prefix="/captions", tags=["captions"])
# No prefix: these hang off /videos/{id}/style and /styles/options, so the
# router declares its own full paths rather than being nested under one.
api_router.include_router(caption_styles.router)

# Milestone 9: the search sub-router gets included here.
