from uuid import UUID

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.security import AuthContext, get_auth_context, get_tenant_db, require_role
from app.config import get_settings
from app.models.entities import Asset, AssetProfile, AuditLog, ProductionLine, Site
from app.schemas.api import (
    AssetCreate,
    AssetOut,
    AssetProfileOut,
    AssetProfileUpdate,
    AssetUpdate,
    LineCreate,
    LineOut,
    SiteCreate,
    SiteOut,
)

router = APIRouter(tags=["hierarchy"])


async def _invalidate_asset_cache(asset_id: UUID) -> None:
    try:
        r = aioredis.from_url(get_settings().valkey_url, decode_responses=True)
        await r.delete(f"profile:{asset_id}")
        await r.aclose()
    except Exception:
        pass


# --- Sites ---
@router.get("/sites", response_model=list[SiteOut])
async def list_sites(db: AsyncSession = Depends(get_tenant_db)):
    rows = (await db.execute(select(Site).order_by(Site.name))).scalars().all()
    return list(rows)


@router.post("/sites", response_model=SiteOut, status_code=status.HTTP_201_CREATED)
async def create_site(
    body: SiteCreate,
    ctx: AuthContext = Depends(require_role("engineer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    site = Site(org_id=ctx.org_id, name=body.name.strip(), location=body.location, timezone=body.timezone)
    db.add(site)
    await db.flush()
    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="site.created",
            resource_type="site",
            resource_id=str(site.id),
            details={"name": site.name},
        )
    )
    return site


# --- Production Lines ---
@router.get("/lines", response_model=list[LineOut])
async def list_lines(site_id: UUID | None = None, db: AsyncSession = Depends(get_tenant_db)):
    stmt = select(ProductionLine).order_by(ProductionLine.name)
    if site_id:
        stmt = stmt.where(ProductionLine.site_id == site_id)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/lines", response_model=LineOut, status_code=status.HTTP_201_CREATED)
async def create_line(
    body: LineCreate,
    ctx: AuthContext = Depends(require_role("engineer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    site = (await db.execute(select(Site).where(Site.id == body.site_id))).scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    line = ProductionLine(
        org_id=ctx.org_id,
        site_id=body.site_id,
        name=body.name.strip(),
        description=body.description,
    )
    db.add(line)
    await db.flush()
    return line


# --- Assets ---
@router.get("/assets", response_model=list[AssetOut])
async def list_assets(
    site_id: UUID | None = None,
    line_id: UUID | None = None,
    db: AsyncSession = Depends(get_tenant_db),
):
    stmt = select(Asset).options(selectinload(Asset.profile)).order_by(Asset.name)
    if site_id:
        stmt = stmt.where(Asset.site_id == site_id)
    if line_id:
        stmt = stmt.where(Asset.line_id == line_id)
    return list((await db.execute(stmt)).scalars().all())


@router.get("/assets/{asset_id}", response_model=AssetOut)
async def get_asset(asset_id: UUID, db: AsyncSession = Depends(get_tenant_db)):
    asset = (
        await db.execute(select(Asset).options(selectinload(Asset.profile)).where(Asset.id == asset_id))
    ).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
    return asset


@router.post("/assets", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
async def create_asset(
    body: AssetCreate,
    ctx: AuthContext = Depends(require_role("engineer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    site = (await db.execute(select(Site).where(Site.id == body.site_id))).scalar_one_or_none()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    asset = Asset(
        org_id=ctx.org_id,
        site_id=body.site_id,
        line_id=body.line_id,
        name=body.name.strip(),
        asset_type=body.asset_type,
        manufacturer=body.manufacturer,
        model_number=body.model_number,
        rated_power_kw=body.rated_power_kw,
        rated_rpm=body.rated_rpm,
    )
    db.add(asset)
    await db.flush()

    profile = AssetProfile(org_id=ctx.org_id, asset_id=asset.id)
    db.add(profile)
    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="asset.created",
            resource_type="asset",
            resource_id=str(asset.id),
            details={"name": asset.name, "asset_type": asset.asset_type},
        )
    )
    await db.flush()
    await db.refresh(asset, attribute_names=["profile"])
    return asset


@router.patch("/assets/{asset_id}", response_model=AssetOut)
async def update_asset(
    asset_id: UUID,
    body: AssetUpdate,
    ctx: AuthContext = Depends(require_role("engineer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    asset = (
        await db.execute(select(Asset).options(selectinload(Asset.profile)).where(Asset.id == asset_id))
    ).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(asset, k, v)
    if "maintenance_mode" in changes and changes["maintenance_mode"]:
        asset.health_status = "MAINTENANCE"

    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="asset.updated",
            resource_type="asset",
            resource_id=str(asset.id),
            details=changes,
        )
    )
    await db.flush()
    await _invalidate_asset_cache(asset.id)
    return asset


@router.put("/assets/{asset_id}/profile", response_model=AssetProfileOut)
async def update_asset_profile(
    asset_id: UUID,
    body: AssetProfileUpdate,
    ctx: AuthContext = Depends(require_role("engineer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    profile = (
        await db.execute(select(AssetProfile).where(AssetProfile.asset_id == asset_id))
    ).scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset profile not found")

    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(profile, k, v)

    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="asset_profile.updated",
            resource_type="asset_profile",
            resource_id=str(asset_id),
            details=changes,
        )
    )
    await db.flush()
    await _invalidate_asset_cache(asset_id)
    return profile
