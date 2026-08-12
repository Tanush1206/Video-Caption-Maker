from fastapi import APIRouter

from app.api import auth, caption_styles, captions, exports, fonts, search, stats, videos

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
# Also unprefixed: exports hang off both /videos/{id}/exports and /exports/{id}.
api_router.include_router(exports.router)
# Unprefixed as well: /fonts and /fonts/{key}/{weight}.ttf.
api_router.include_router(fonts.router)
api_router.include_router(search.router)
api_router.include_router(stats.router)
