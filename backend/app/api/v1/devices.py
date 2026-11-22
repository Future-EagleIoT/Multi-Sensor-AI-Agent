from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import AuthContext, get_tenant_db, require_role
from app.models.entities import Asset, AuditLog, Device
from app.schemas.api import DeviceCreate, DeviceOut, DeviceProvisionOut
from app.services.pki import mint_device_certificate

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=list[DeviceOut])
async def list_devices(db: AsyncSession = Depends(get_tenant_db)):
    rows = (await db.execute(select(Device).order_by(Device.device_uid))).scalars().all()
    return list(rows)


@router.post("", response_model=DeviceProvisionOut, status_code=status.HTTP_201_CREATED)
async def provision_device(
    body: DeviceCreate,
    ctx: AuthContext = Depends(require_role("engineer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    if body.asset_id:
        asset = (await db.execute(select(Asset).where(Asset.id == body.asset_id))).scalar_one_or_none()
        if not asset:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    existing = (
        await db.execute(select(Device).where(Device.device_uid == body.device_uid))
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Device UID already exists in org")

    cert_bundle = mint_device_certificate(ctx.org_slug, body.device_uid)

    device = Device(
        org_id=ctx.org_id,
        asset_id=body.asset_id,
        device_uid=body.device_uid,
        protocol=body.protocol,
        firmware_version=body.firmware_version,
        cert_cn=cert_bundle["cert_cn"],
        cert_fingerprint=cert_bundle["fingerprint"],
        status="provisioned",
    )
    db.add(device)
    await db.flush()
    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="device.provisioned",
            resource_type="device",
            resource_id=str(device.id),
            details={"device_uid": device.device_uid, "cert_cn": device.cert_cn},
        )
    )
    return DeviceProvisionOut(device=DeviceOut.model_validate(device), cert_bundle=cert_bundle)


@router.post("/{device_id}/revoke", response_model=DeviceOut)
async def revoke_device(
    device_id: UUID,
    ctx: AuthContext = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    device = (await db.execute(select(Device).where(Device.id == device_id))).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    device.is_revoked = True
    device.status = "offline"
    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="device.revoked",
            resource_type="device",
            resource_id=str(device.id),
            details={"device_uid": device.device_uid},
        )
    )
    await db.flush()
    return device


@router.post("/{device_id}/rotate-cert", response_model=DeviceProvisionOut)
async def rotate_device_cert(
    device_id: UUID,
    ctx: AuthContext = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    device = (await db.execute(select(Device).where(Device.id == device_id))).scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    cert_bundle = mint_device_certificate(ctx.org_slug, device.device_uid)
    device.cert_fingerprint = cert_bundle["fingerprint"]
    device.is_revoked = False
    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="device.cert_rotated",
            resource_type="device",
            resource_id=str(device.id),
            details={"device_uid": device.device_uid, "fingerprint": device.cert_fingerprint},
        )
    )
    await db.flush()
    return DeviceProvisionOut(device=DeviceOut.model_validate(device), cert_bundle=cert_bundle)
