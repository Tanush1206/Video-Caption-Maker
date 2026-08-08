"""Dashboard aggregates."""

from dataclasses import asdict

from fastapi import APIRouter

from app.dependencies import CurrentUser, DbSession
from app.schemas.stats import StatsResponse
from app.services import stats as stats_service

router = APIRouter()


@router.get("/stats", response_model=StatsResponse, tags=["stats"])
async def read_stats(user: CurrentUser, db: DbSession) -> StatsResponse:
    """
    Counts and totals for the signed-in user's library.

    Scoped by owner in the query, like every other list endpoint — a stats
    route that leaked the whole table's totals would be a slow way to learn
    how much data everyone else has.
    """
    return StatsResponse(**asdict(await stats_service.library_stats(db, user.id)))
