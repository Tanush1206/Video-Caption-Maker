from pydantic import BaseModel


class StatsResponse(BaseModel):
    """Dashboard aggregates for the signed-in user's library."""

    videos: int
    # Keyed by VideoStatus value, with every status present even at zero.
    by_status: dict[str, int]
    storage_bytes: int
    duration_ms: int
    captions: int
    exports: int
    # Free space on the host disk, shared by everyone. Not a per-user quota,
    # and the UI must not present it as one.
    disk_free_bytes: int
