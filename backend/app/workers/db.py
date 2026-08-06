"""
Database access for Celery tasks.

Celery tasks are synchronous while our data layer is async, so each task runs
its coroutine with `asyncio.run()`. That creates a *new event loop* every
time, and the module-level engine in app.database is bound to whichever loop
first used it — reusing it here fails with "Event loop is closed" on the
second task. (The test suite hit exactly this and fixed it the other way, by
pinning one loop for the whole session.)

So a worker builds its own engine per task and disposes it afterwards. Tasks
run for minutes, so the setup cost is irrelevant, and NullPool avoids holding
connections open between jobs.
"""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()


@asynccontextmanager
async def worker_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(settings.database_url, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()
