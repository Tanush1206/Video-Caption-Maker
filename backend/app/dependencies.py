"""
Shared FastAPI dependencies. Grows in Milestone 2 to include
get_current_user (JWT decode + DB lookup) used across protected routes.
"""

from app.config import Settings, get_settings

# Re-exported so routes can do: settings: Settings = Depends(get_settings)
__all__ = ["get_settings", "Settings"]
