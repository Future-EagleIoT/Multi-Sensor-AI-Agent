from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import AuthContext, get_tenant_db, require_role
from app.models.entities import Alert, Asset, AuditLog, WorkOrder
from app.schemas.api import (
    AlertFeedback,
    AlertOut,
    AlertUpdate,
    WorkOrderCreate,
    WorkOrderOut,
    WorkOrderUpdate,
)
from app.services.ws_manager import ws_manager

router = APIRouter(tags=["alerts-and-work-orders"])


@router.get("/alerts", response_model=list[AlertOut])
async def list_alerts(
    status_filter: str | None = Query(default=None, alias="status"),
    severity: str | None = None,
    asset_id: UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_tenant_db),
):
    stmt = select(Alert).order_by(Alert.created_at.desc()).limit(limit)
    if status_filter == "active":
        stmt = stmt.where(Alert.status.in_(["open", "acknowledged", "in_progress"]))
    elif status_filter:
        stmt = stmt.where(Alert.status == status_filter)
    if severity:
        stmt = stmt.where(Alert.severity == severity.upper())
    if asset_id:
        stmt = stmt.where(Alert.asset_id == asset_id)
    return list((await db.execute(stmt)).scalars().all())


@router.get("/alerts/{alert_id}", response_model=AlertOut)
async def get_alert(alert_id: UUID, db: AsyncSession = Depends(get_tenant_db)):
    alert = (await db.execute(select(Alert).where(Alert.id == alert_id))).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    return alert


@router.patch("/alerts/{alert_id}", response_model=AlertOut)
async def update_alert(
    alert_id: UUID,
    body: AlertUpdate,
    ctx: AuthContext = Depends(require_role("technician")),
    db: AsyncSession = Depends(get_tenant_db),
):
    alert = (await db.execute(select(Alert).where(Alert.id == alert_id))).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    now = datetime.now(timezone.utc)
    alert.status = body.status
    if body.resolution_notes is not None:
        alert.resolution_notes = body.resolution_notes

    if body.status == "acknowledged" and alert.acknowledged_at is None:
        alert.acknowledged_by = ctx.user_id
        alert.acknowledged_at = now
    elif body.status in ("resolved", "false_positive"):
        alert.resolved_by = ctx.user_id
        alert.resolved_at = now

    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action=f"alert.{body.status}",
            resource_type="alert",
            resource_id=str(alert.id),
            details={"notes": body.resolution_notes},
        )
    )
    await db.flush()
    out = AlertOut.model_validate(alert)
    await ws_manager.publish_org_event(ctx.org_id, "alert.updated", out.model_dump(mode="json"))
    return out


@router.post("/alerts/{alert_id}/feedback", response_model=AlertOut)
async def rate_ai_diagnosis(
    alert_id: UUID,
    body: AlertFeedback,
    ctx: AuthContext = Depends(require_role("technician")),
    db: AsyncSession = Depends(get_tenant_db),
):
    alert = (await db.execute(select(Alert).where(Alert.id == alert_id))).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    if body.feedback not in (-1, 1):
        raise HTTPException(status_code=400, detail="feedback must be 1 or -1")
    alert.ai_feedback = body.feedback
    await db.flush()
    return alert


# --- Work Orders ---
@router.get("/work-orders", response_model=list[WorkOrderOut])
async def list_work_orders(
    status_filter: str | None = Query(default=None, alias="status"),
    db: AsyncSession = Depends(get_tenant_db),
):
    stmt = select(WorkOrder).order_by(WorkOrder.created_at.desc()).limit(100)
    if status_filter:
        stmt = stmt.where(WorkOrder.status == status_filter)
    return list((await db.execute(stmt)).scalars().all())


@router.post("/work-orders", response_model=WorkOrderOut, status_code=status.HTTP_201_CREATED)
async def create_work_order(
    body: WorkOrderCreate,
    ctx: AuthContext = Depends(require_role("technician")),
    db: AsyncSession = Depends(get_tenant_db),
):
    asset = (await db.execute(select(Asset).where(Asset.id == body.asset_id))).scalar_one_or_none()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    wo = WorkOrder(
        org_id=ctx.org_id,
        asset_id=body.asset_id,
        alert_id=body.alert_id,
        title=body.title.strip(),
        description=body.description,
        priority=body.priority,
        assigned_to=body.assigned_to,
        created_by=ctx.user_id,
    )
    db.add(wo)
    await db.flush()
    db.add(
        AuditLog(
            org_id=ctx.org_id,
            user_id=ctx.user_id,
            action="work_order.created",
            resource_type="work_order",
            resource_id=str(wo.id),
            details={"title": wo.title, "priority": wo.priority},
        )
    )
    return wo


@router.patch("/work-orders/{wo_id}", response_model=WorkOrderOut)
async def update_work_order(
    wo_id: UUID,
    body: WorkOrderUpdate,
    ctx: AuthContext = Depends(require_role("technician")),
    db: AsyncSession = Depends(get_tenant_db),
):
    wo = (await db.execute(select(WorkOrder).where(WorkOrder.id == wo_id))).scalar_one_or_none()
    if not wo:
        raise HTTPException(status_code=404, detail="Work order not found")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(wo, k, v)
    if body.status == "completed":
        wo.completed_at = datetime.now(timezone.utc)
    await db.flush()
    return wo
