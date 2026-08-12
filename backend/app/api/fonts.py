"""
The Google Fonts library: searching the catalogue, and serving the bytes.

Two endpoints, and the second is the one that matters. `/api/fonts/{key}/{weight}.ttf`
downloads the face on first request and serves it from disk forever after — and
it is the *same file* the worker's libass will load when the video is burned.
That is the whole design: one file, two renderers, nothing to keep in sync.

Neither endpoint requires auth. The catalogue is a static description of what
the app can do, and the font files are public, unmodified Google Fonts under
their own licences — putting a session in front of them would gate nothing and
break browser font loading, which does not send credentials.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.schemas.font import FontLibraryEntry, FontSearchResult
from app.services import font_library

log = logging.getLogger(__name__)

router = APIRouter()

# A year, immutable. These files never change: the catalogue pins a specific
# path in google/fonts, and a family that changed would be a new entry.
CACHE_CONTROL = "public, max-age=31536000, immutable"


def _entry(font: font_library.LibraryFont) -> FontLibraryEntry:
    return FontLibraryEntry(
        key=font.key,
        family=font.family,
        category=font.category,
        has_bold=font.has_bold,
        css_stack=f'"{font.family}", sans-serif',
    )


@router.get("/fonts", response_model=FontSearchResult, tags=["fonts"])
async def search_fonts(
    q: str = Query("", max_length=64, description="Substring of the family name"),
    category: str | None = Query(None, max_length=32),
    limit: int = Query(60, ge=1, le=200),
) -> FontSearchResult:
    """
    Search the catalogue.

    Capped rather than paged. 1301 families is too many to scroll and the
    picker is a search box, so the honest answer to a broad query is the first
    sixty plus a count of what was left out — not a pager nobody will walk
    through.

    The full match list is built before slicing so `matched` is exact. It is a
    list comprehension over 1301 dataclasses held in memory; measured at well
    under a millisecond, which is cheaper than the alternative of the picker
    lying about how many fonts a search found.
    """
    found = font_library.matches(q, category=category)
    page = found[:limit]
    return FontSearchResult(
        total=len(font_library.all_fonts()),
        matched=len(found),
        returned=len(page),
        fonts=[_entry(font) for font in page],
    )


@router.get("/fonts/{key}/{weight}.ttf", tags=["fonts"])
async def get_font_file(key: str, weight: str) -> Response:
    """
    The face itself, downloaded on first request and cached from then on.

    Returned as bytes rather than a redirect to Google on purpose: the redirect
    would hand every viewer's IP to a third party, and — the part that actually
    breaks things — the browser would then be rendering a file the worker never
    saw. Serving it from here is what makes "the preview matches the export"
    true rather than hopeful.
    """
    try:
        path = font_library.ensure(key, weight)
    except LookupError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except RuntimeError as exc:
        # The catalogue promised a font the network could not deliver. 502
        # rather than 500: nothing here is broken, the upstream did not answer.
        log.warning("font download failed for %s/%s: %s", key, weight, exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    return Response(
        content=path.read_bytes(),
        media_type="font/ttf",
        headers={"Cache-Control": CACHE_CONTROL},
    )
