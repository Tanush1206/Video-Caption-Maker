"""
ORM models.

Import every model here so Alembic's autogenerate and `Base.metadata`
see the full set of tables.
"""

from app.models.user import User

__all__ = ["User"]
