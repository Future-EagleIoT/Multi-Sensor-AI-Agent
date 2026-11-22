from datetime import datetime, timezone
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    plan_tier: Mapped[str] = mapped_column(String(32), nullable=False, default="pro")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_membership_org_user"),)

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="engineer")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    organization: Mapped[Organization] = relationship()
    user: Mapped[User] = relationship()


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="technician")
    token: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    invited_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Site(Base):
    __tablename__ = "sites"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ProductionLine(Base):
    __tablename__ = "production_lines"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    site_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    site_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("production_lines.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(64), nullable=False, default="motor")
    manufacturer: Mapped[str | None] = mapped_column(String(120), nullable=True)
    model_number: Mapped[str | None] = mapped_column(String(120), nullable=True)
    rated_power_kw: Mapped[float | None] = mapped_column(Float, nullable=True)
    rated_rpm: Mapped[int | None] = mapped_column(Integer, nullable=True)
    health_status: Mapped[str] = mapped_column(String(32), nullable=False, default="UNKNOWN")
    maintenance_mode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_telemetry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latest_metrics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    profile: Mapped["AssetProfile | None"] = relationship(
        back_populates="asset", uselist=False, cascade="all, delete-orphan"
    )


class AssetProfile(Base):
    __tablename__ = "asset_profiles"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    # Baselines (healthy operating idle/nominal)
    baseline_temp: Mapped[float] = mapped_column(Float, nullable=False, default=30.0)
    baseline_humidity: Mapped[float] = mapped_column(Float, nullable=False, default=55.0)
    baseline_vibration_hz: Mapped[float] = mapped_column(Float, nullable=False, default=12.0)
    baseline_power_w: Mapped[float] = mapped_column(Float, nullable=False, default=85.0)
    # Thresholds
    warn_temp: Mapped[float] = mapped_column(Float, nullable=False, default=35.0)
    crit_temp: Mapped[float] = mapped_column(Float, nullable=False, default=37.0)
    warn_humidity: Mapped[float] = mapped_column(Float, nullable=False, default=75.0)
    crit_humidity: Mapped[float] = mapped_column(Float, nullable=False, default=80.0)
    warn_vibration_hz: Mapped[float] = mapped_column(Float, nullable=False, default=17.0)
    crit_vibration_hz: Mapped[float] = mapped_column(Float, nullable=False, default=20.0)
    warn_power_w: Mapped[float] = mapped_column(Float, nullable=False, default=115.0)
    crit_power_w: Mapped[float] = mapped_column(Float, nullable=False, default=130.0)
    # Correlation & rapid-change parameters
    corr_min_signals: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    corr_temp_delta: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    corr_vib_delta: Mapped[float] = mapped_column(Float, nullable=False, default=2.0)
    corr_power_delta: Mapped[float] = mapped_column(Float, nullable=False, default=16.0)
    rapid_window: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    rapid_temp_delta: Mapped[float] = mapped_column(Float, nullable=False, default=3.0)
    # Cooldown exponential backoff
    cooldown_base_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    cooldown_multiplier: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    cooldown_max_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=120)
    normal_reset_readings: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    asset: Mapped[Asset] = relationship(back_populates="profile")


class Device(Base):
    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("org_id", "device_uid", name="uq_device_org_uid"),)

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("assets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    device_uid: Mapped[str] = mapped_column(String(80), nullable=False)
    protocol: Mapped[str] = mapped_column(String(32), nullable=False, default="mqtt")
    firmware_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cert_cn: Mapped[str] = mapped_column(String(180), nullable=False, unique=True)
    cert_fingerprint: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="provisioned")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SensorReading(Base):
    __tablename__ = "sensor_readings"

    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True, default=utcnow)
    org_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    device_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    asset_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity: Mapped[float | None] = mapped_column(Float, nullable=True)
    vibration_hz: Mapped[float | None] = mapped_column(Float, nullable=True)
    power_w: Mapped[float | None] = mapped_column(Float, nullable=True)
    vib_rms_mm_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    iso_zone: Mapped[str | None] = mapped_column(String(8), nullable=True)
    extra_metadata: Mapped[dict] = mapped_column("metadata", JSONB, nullable=False, default=dict)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    device_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="open", index=True)
    trigger_reason: Mapped[str] = mapped_column(Text, nullable=False)
    trigger_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    ai_status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    ai_diagnosis: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ai_feedback: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    acknowledged_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class WorkOrder(Base):
    __tablename__ = "work_orders"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    alert_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("alerts.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="high")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="open")
    assigned_to: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AssetManual(Base):
    __tablename__ = "asset_manuals"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uploaded_by: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ManualChunk(Base):
    __tablename__ = "manual_chunks"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    manual_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("asset_manuals.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("assets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    section_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float]] = mapped_column(Vector(384), nullable=False)


class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(String(512), nullable=False)
    secret: Mapped[str | None] = mapped_column(String(128), nullable=True)
    events: Mapped[list] = mapped_column(JSONB, nullable=False, default=lambda: ["alert.created", "device.offline"])
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    org_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
