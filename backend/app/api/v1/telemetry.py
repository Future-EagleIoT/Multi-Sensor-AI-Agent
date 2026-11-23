from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import get_tenant_db
from app.models.entities import Alert, Asset, Device
from app.schemas.api import TelemetryPoint

router = APIRouter(prefix="/telemetry", tags=["telemetry"])

RANGE_CONFIG = {
    "15m": (timedelta(minutes=15), None),
    "1h": (timedelta(hours=1), "15 seconds"),
    "6h": (timedelta(hours=6), "1 minute"),
    "24h": (timedelta(hours=24), "5 minutes"),
    "7d": (timedelta(days=7), "30 minutes"),
}


@router.get("/fleet-summary")
async def fleet_summary(db: AsyncSession = Depends(get_tenant_db)):
    assets = list((await db.execute(select(Asset))).scalars().all())
    devices = list((await db.execute(select(Device))).scalars().all())
    open_alerts = (
        await db.execute(
            select(func.count()).select_from(Alert).where(Alert.status.in_(["open", "acknowledged", "in_progress"]))
        )
    ).scalar_one()
    critical_open = (
        await db.execute(
            select(func.count())
            .select_from(Alert)
            .where(Alert.status.in_(["open", "acknowledged", "in_progress"]), Alert.severity == "CRITICAL")
        )
    ).scalar_one()

    status_counts: dict[str, int] = {}
    for a in assets:
        status_counts[a.health_status] = status_counts.get(a.health_status, 0) + 1

    online_devices = sum(1 for d in devices if d.status == "online" and not d.is_revoked)
    return {
        "total_assets": len(assets),
        "total_devices": len(devices),
        "online_devices": online_devices,
        "offline_devices": len(devices) - online_devices,
        "open_alerts": open_alerts,
        "critical_open_alerts": critical_open,
        "asset_status_breakdown": status_counts,
    }


@router.get("/assets/{asset_id}", response_model=list[TelemetryPoint])
async def asset_telemetry(
    asset_id: UUID,
    window: str = Query(default="15m", alias="range"),
    limit: int = Query(default=300, ge=10, le=1000),
    db: AsyncSession = Depends(get_tenant_db),
):
    if window not in RANGE_CONFIG:
        raise HTTPException(status_code=400, detail=f"Unsupported range '{window}'. Use one of {list(RANGE_CONFIG)}")

    asset = (await db.execute(select(Asset).where(Asset.id == asset_id))).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    delta, bucket = RANGE_CONFIG[window]
    since = datetime.now(timezone.utc) - delta

    if bucket is None:
        stmt = text("""
            SELECT time, temperature, humidity, vibration_hz, power_w, vib_rms_mm_s, iso_zone, 1 AS sample_count
            FROM sensor_readings
            WHERE asset_id = :asset_id AND time >= :since
            ORDER BY time DESC
            LIMIT :limit
        """)
        rows = (await db.execute(stmt, {"asset_id": asset_id, "since": since, "limit": limit})).mappings().all()
        rows = list(reversed(rows))
    else:
        stmt = text(f"""
            SELECT
                time_bucket('{bucket}', time) AS time,
                AVG(temperature) AS temperature,
                AVG(humidity) AS humidity,
                AVG(vibration_hz) AS vibration_hz,
                AVG(power_w) AS power_w,
                AVG(vib_rms_mm_s) AS vib_rms_mm_s,
                MAX(iso_zone) AS iso_zone,
                COUNT(*)::int AS sample_count
            FROM sensor_readings
            WHERE asset_id = :asset_id AND time >= :since
            GROUP BY 1
            ORDER BY 1 ASC
            LIMIT :limit
        """)
        rows = (await db.execute(stmt, {"asset_id": asset_id, "since": since, "limit": limit})).mappings().all()

    return [TelemetryPoint(**dict(r)) for r in rows]
