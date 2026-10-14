"""
The suite runs against its own database, queue, vectors and storage.

It used to run against the dev stack's live database, deleting `test-%` users
as it went. These pin the redirection conftest.py sets up, so a change there
cannot quietly point the tests back at real data.
"""

import tempfile
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.database import AsyncSessionLocal


def test_settings_point_at_the_test_stores():
    settings = get_settings()
    assert make_url(settings.database_url).database.endswith("_test")
    assert settings.redis_url.endswith("/14")
    assert settings.chroma_collection == "captions_test"
    assert Path(settings.storage_local_path).is_relative_to(tempfile.gettempdir())


async def test_the_app_is_connected_to_the_test_database():
    async with AsyncSessionLocal() as session:
        name = (await session.execute(text("SELECT current_database()"))).scalar_one()
    assert name.endswith("_test")


async def test_the_test_database_is_migrated_to_head():
    async with AsyncSessionLocal() as session:
        version = (await session.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "alembic"))
    head = ScriptDirectory.from_config(config).get_current_head()
    assert version == head
