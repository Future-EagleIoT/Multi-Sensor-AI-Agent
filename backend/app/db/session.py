from collections.abc import AsyncGenerator
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

# Admin engine: used ONLY for login lookups, migrations, seed, and trusted background workers.
admin_engine = create_async_engine(
    settings.admin_database_url,
    pool_size=10,
    max_overflow=10,
    pool_pre_ping=True,
)
AdminSessionLocal = async_sessionmaker(admin_engine, expire_on_commit=False, class_=AsyncSession)

# App engine (non-superuser role `eagle_app`): enforces PostgreSQL Row-Level Security!
app_engine = create_async_engine(
    settings.app_database_url,
    pool_size=15,
    max_overflow=15,
    pool_pre_ping=True,
)
AppSessionLocal = async_sessionmaker(app_engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


async def get_admin_db() -> AsyncGenerator[AsyncSession, None]:
    async with AdminSessionLocal() as session:
        yield session


async def open_tenant_session(org_id: UUID) -> AsyncGenerator[AsyncSession, None]:
    """Yields a DB session bound to `eagle_app` with `app.current_org_id` set for RLS."""
    async with AppSessionLocal() as session:
        async with session.begin():
            await session.execute(
                text("SELECT set_config('app.current_org_id', :org_id, true)"),
                {"org_id": str(org_id)},
            )
            yield session
