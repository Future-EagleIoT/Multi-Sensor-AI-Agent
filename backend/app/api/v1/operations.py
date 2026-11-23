from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import AuthContext, get_tenant_db, require_role
from app.models.entities import Alert, Asset, AssetManual, AuditLog, ManualChunk, Webhook
from app.schemas.api import AuditLogOut, ManualOut, WebhookCreate, WebhookOut
from app.services.embeddings import chunk_manual_text, embed_text
from app.services.reports import build_incident_pdf, build_telemetry_csv
from app.services.storage import upload_bytes

router = APIRouter(tags=["manuals-webhooks-reports"])


# --- Asset Manuals (RAG Ingestion into pgvector + RustFS Object Storage) ---
@router.get("/assets/{asset_id}/manuals", response_model=list[ManualOut])
async def list_manuals(asset_id: UUID, db: AsyncSession = Depends(get_tenant_db)):
    rows = (
        await db.execute(
            select(AssetManual).where(AssetManual.asset_id == asset_id).order_by(AssetManual.created_at.desc())
        )
    ).scalars().all()
    return list(rows)


@router.post("/assets/{asset_id}/manuals", response_model=ManualOut, status_code=status.HTTP_201_CREATED)
async def upload_manual(
    asset_id: UUID,
    file: UploadFile = File(...),
    ctx: AuthContext = Depends(require_role("engineer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    asset = (await db.execute(select(Asset).where(Asset.id == asset_id))).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    raw = await file.read()
    if not raw or len(raw) > 2_000_000:
        raise HTTPException(status_code=400, detail="Manual must be non-empty and under 2 MB")

    filename = (file.filename or "manual.txt").replace("/", "_")
    storage_key = f"tenants/{ctx.org_slug}/manuals/{asset_id}/{filename}"
    try:
        upload_bytes(storage_key, raw, content_type=file.content_type or "text/plain")
    except Exception:
        # Local dev fallback if storage container is still booting
        pass

    text_content = raw.decode("utf-8", errors="ignore")
    chunks = chunk_manual_text(text_content)

    manual = AssetManual(
        org_id=ctx.org_id,
        asset_id=asset_id,
        filename=filename,
        storage_key=storage_key,
        chunk_count=len(chunks),
        uploaded_by=ctx.user_id,
    )
    db.add(manual)
    await db.flush()

    for idx, (section, content) in enumerate(chunks):
        db.add(
            ManualChunk(
                org_id=ctx.org_id,
                manual_id=manual.id,
                asset_id=asset_id,
                chunk_index=idx,
                section_title=section,
                content=content,
                embedding=embed_text(f"{section}\n{content}"),
            )
        )

    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="manual.uploaded",
            resource_type="asset_manual",
            resource_id=str(manual.id),
            details={"filename": filename, "chunks": len(chunks)},
        )
    )
    await db.flush()
    return manual


# --- Webhooks ---
@router.get("/webhooks", response_model=list[WebhookOut])
async def list_webhooks(db: AsyncSession = Depends(get_tenant_db)):
    return list((await db.execute(select(Webhook).order_by(Webhook.created_at.desc()))).scalars().all())


@router.post("/webhooks", response_model=WebhookOut, status_code=status.HTTP_201_CREATED)
async def create_webhook(
    body: WebhookCreate,
    ctx: AuthContext = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    wh = Webhook(
        org_id=ctx.org_id,
        name=body.name.strip(),
        url=body.url.strip(),
        secret=body.secret,
        events=body.events,
    )
    db.add(wh)
    await db.flush()
    return wh


@router.delete("/webhooks/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(
    webhook_id: UUID,
    ctx: AuthContext = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_tenant_db),
):
    wh = (await db.execute(select(Webhook).where(Webhook.id == webhook_id))).scalar_one_or_none()
    if not wh:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await db.delete(wh)


# --- Audit Logs ---
@router.get("/audit-logs", response_model=list[AuditLogOut])
async def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    ctx: AuthContext = Depends(require_role("engineer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    rows = (
        await db.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit))
    ).scalars().all()
    return list(rows)


# --- Reports (CSV & PDF) ---
@router.get("/reports/telemetry.csv")
async def export_telemetry_csv(
    asset_id: UUID | None = None,
    hours: int = Query(default=24, ge=1, le=168),
    ctx: AuthContext = Depends(require_role("viewer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    if asset_id:
        stmt = text("""
            SELECT time, asset_id, temperature, humidity, vibration_hz, power_w, vib_rms_mm_s, iso_zone
            FROM sensor_readings
            WHERE asset_id = :asset_id AND time >= :since
            ORDER BY time DESC
            LIMIT 5000
        """)
        rows = (await db.execute(stmt, {"asset_id": asset_id, "since": since})).mappings().all()
    else:
        stmt = text("""
            SELECT time, asset_id, temperature, humidity, vibration_hz, power_w, vib_rms_mm_s, iso_zone
            FROM sensor_readings
            WHERE time >= :since
            ORDER BY time DESC
            LIMIT 5000
        """)
        rows = (await db.execute(stmt, {"since": since})).mappings().all()

    csv_bytes = build_telemetry_csv([dict(r) for r in rows])
    return Response(
        content=csv_bytes,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{ctx.org_slug}_telemetry_{hours}h.csv"'},
    )


@router.get("/reports/incident.pdf")
async def export_incident_pdf(
    hours: int = Query(default=24, ge=1, le=168),
    ctx: AuthContext = Depends(require_role("viewer")),
    db: AsyncSession = Depends(get_tenant_db),
):
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    assets = list((await db.execute(select(Asset).order_by(Asset.name))).scalars().all())
    alerts = list(
        (await db.execute(select(Alert).where(Alert.created_at >= since).order_by(Alert.created_at.desc()))).scalars().all()
    )

    pdf_bytes = build_incident_pdf(
        org_name=ctx.org_name,
        assets=[
            {
                "name": a.name,
                "asset_type": a.asset_type,
                "health_status": a.health_status,
                "latest_metrics": a.latest_metrics,
            }
            for a in assets
        ],
        alerts=[
            {
                "severity": al.severity,
                "status": al.status,
                "trigger_reason": al.trigger_reason,
                "ai_diagnosis": al.ai_diagnosis,
                "created_at": al.created_at,
            }
            for al in alerts
        ],
        period_hours=hours,
    )

    try:
        ts_slug = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        upload_bytes(f"tenants/{ctx.org_slug}/reports/incident_{ts_slug}.pdf", pdf_bytes, "application/pdf")
    except Exception:
        pass

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{ctx.org_slug}_incident_report_{hours}h.pdf"'},
    )
