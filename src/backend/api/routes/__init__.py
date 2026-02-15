from .health import router as health_router
from .intel import router as intel_router
from .players import router as players_router
from .screener import router as screener_router
from .sync import router as sync_router

__all__ = [
    "health_router",
    "players_router",
    "screener_router",
    "sync_router",
    "intel_router",
]
