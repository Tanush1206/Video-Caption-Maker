"""
Library-wide aggregates for the dashboard.

Deliberately computed in SQL rather than by loading rows and summing in Python.
The dashboard asks for this on every visit, and a user with two hundred videos
should not cause two hundred rows to cross the wire so we can add up a column
the database can add up itself.
"""

from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.caption import Caption
from app.models.export import Export
from app.models.video import Video, VideoStatus
from app.services import storage


@dataclass
class LibraryStats:
    videos: int = 0
    # Every status is present even at zero, so the client never has to decide
    # what a missing key means.
    by_status: dict[str, int] = field(default_factory=dict)
    storage_bytes: int = 0
    duration_ms: int = 0
    captions: int = 0
    exports: int = 0
    disk_free_bytes: int = 0


async def library_stats(db: AsyncSession, owner_id: int) -> LibraryStats:
    """
    Everything the dashboard needs, in three queries rather than three per row.

    The video figures come from a single grouped scan: counting, sizing and
    timing the library are the same aggregate over the same rows, so asking
    separately would be three passes for one answer.
    """
    rows = (
        await db.execute(
            select(
                Video.status,
                func.count(Video.id),
                func.coalesce(func.sum(Video.size_bytes), 0),
                func.coalesce(func.sum(Video.duration_ms), 0),
            )
            .where(Video.owner_id == owner_id)
            .group_by(Video.status)
        )
    ).all()

    stats = LibraryStats(by_status={status.value: 0 for status in VideoStatus})

    for status, count, size_bytes, duration_ms in rows:
        # SUM over a BIGINT column comes back as NUMERIC in Postgres, which
        # SQLAlchemy hands over as Decimal. Left alone it serialises as a JSON
        # float and a 4 GB library starts reporting fractional bytes.
        stats.by_status[status.value] = int(count)
        stats.videos += int(count)
        stats.storage_bytes += int(size_bytes)
        stats.duration_ms += int(duration_ms)

    # Both of these join through videos: the child tables have no owner column,
    # and adding one would be a second copy of a fact the FK already carries.
    stats.captions = int(
        await db.scalar(
            select(func.count(Caption.id))
            .join(Video, Caption.video_id == Video.id)
            .where(Video.owner_id == owner_id)
        )
        or 0
    )

    stats.exports = int(
        await db.scalar(
            select(func.count(Export.id))
            .join(Video, Export.video_id == Video.id)
            .where(Video.owner_id == owner_id)
        )
        or 0
    )

    # Host-wide, not per-user: there are no quotas yet, so the honest thing to
    # report is how much room the machine has left. The client labels it as
    # such rather than presenting it as an allowance.
    stats.disk_free_bytes = storage.free_space_bytes()

    return stats
