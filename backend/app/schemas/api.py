from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Auth & Organizations ---
class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    organization_name: str = Field(min_length=2, max_length=160)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    org_id: UUID | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class SwitchOrgRequest(BaseModel):
    org_id: UUID


class InviteRequest(BaseModel):
    email: EmailStr
    role: str = Field(default="technician", pattern="^(owner|admin|engineer|technician|viewer)$")


class AcceptInviteRequest(BaseModel):
    token: str
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=8, max_length=128)


class OrgSummary(ORMBase):
    id: UUID
    name: str
    slug: str
    plan_tier: str
    role: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: UUID
    email: EmailStr
    full_name: str
    active_org: OrgSummary
    organizations: list[OrgSummary]


class MemberOut(BaseModel):
    user_id: UUID
    email: str
    full_name: str
    role: str
    joined_at: datetime


# --- Hierarchy ---
class SiteCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    location: str | None = None
    timezone: str = "UTC"


class SiteOut(ORMBase):
    id: UUID
    org_id: UUID
    name: str
    location: str | None
    timezone: str
    created_at: datetime


class LineCreate(BaseModel):
    site_id: UUID
    name: str = Field(min_length=2, max_length=160)
    description: str | None = None


class LineOut(ORMBase):
    id: UUID
    org_id: UUID
    site_id: UUID
    name: str
    description: str | None
    created_at: datetime


class AssetCreate(BaseModel):
    site_id: UUID
    line_id: UUID | None = None
    name: str = Field(min_length=2, max_length=160)
    asset_type: str = "motor"
    manufacturer: str | None = None
    model_number: str | None = None
    rated_power_kw: float | None = None
    rated_rpm: int | None = None


class AssetUpdate(BaseModel):
    name: str | None = None
    line_id: UUID | None = None
    maintenance_mode: bool | None = None
    manufacturer: str | None = None
    model_number: str | None = None
    rated_power_kw: float | None = None
    rated_rpm: int | None = None


class AssetProfileUpdate(BaseModel):
    baseline_temp: float | None = None
    baseline_humidity: float | None = None
    baseline_vibration_hz: float | None = None
    baseline_power_w: float | None = None
    warn_temp: float | None = None
    crit_temp: float | None = None
    warn_humidity: float | None = None
    crit_humidity: float | None = None
    warn_vibration_hz: float | None = None
    crit_vibration_hz: float | None = None
    warn_power_w: float | None = None
    crit_power_w: float | None = None
    corr_min_signals: int | None = Field(default=None, ge=2, le=4)
    corr_temp_delta: float | None = None
    corr_vib_delta: float | None = None
    corr_power_delta: float | None = None
    rapid_window: int | None = Field(default=None, ge=2, le=20)
    rapid_temp_delta: float | None = None
    cooldown_base_sec: int | None = Field(default=None, ge=5, le=600)
    cooldown_multiplier: int | None = Field(default=None, ge=1, le=5)
    cooldown_max_sec: int | None = Field(default=None, ge=10, le=3600)
    normal_reset_readings: int | None = Field(default=None, ge=1, le=20)


class AssetProfileOut(ORMBase):
    id: UUID
    asset_id: UUID
    baseline_temp: float
    baseline_humidity: float
    baseline_vibration_hz: float
    baseline_power_w: float
    warn_temp: float
    crit_temp: float
    warn_humidity: float
    crit_humidity: float
    warn_vibration_hz: float
    crit_vibration_hz: float
    warn_power_w: float
    crit_power_w: float
    corr_min_signals: int
    corr_temp_delta: float
    corr_vib_delta: float
    corr_power_delta: float
    rapid_window: int
    rapid_temp_delta: float
    cooldown_base_sec: int
    cooldown_multiplier: int
    cooldown_max_sec: int
    normal_reset_readings: int
    updated_at: datetime


class AssetOut(ORMBase):
    id: UUID
    org_id: UUID
    site_id: UUID
    line_id: UUID | None
    name: str
    asset_type: str
    manufacturer: str | None
    model_number: str | None
    rated_power_kw: float | None
    rated_rpm: int | None
    health_status: str
    maintenance_mode: bool
    last_telemetry_at: datetime | None
    latest_metrics: dict[str, Any]
    created_at: datetime
    profile: AssetProfileOut | None = None


# --- Devices ---
class DeviceCreate(BaseModel):
    asset_id: UUID | None = None
    device_uid: str = Field(min_length=2, max_length=80, pattern="^[a-z0-9][a-z0-9_-]*$")
    protocol: str = Field(default="mqtt", pattern="^(mqtt|modbus|opcua)$")
    firmware_version: str | None = "2.0.0"


class DeviceOut(ORMBase):
    id: UUID
    org_id: UUID
    asset_id: UUID | None
    device_uid: str
    protocol: str
    firmware_version: str | None
    cert_cn: str
    cert_fingerprint: str | None
    is_revoked: bool
    status: str
    last_seen_at: datetime | None
    created_at: datetime


class DeviceProvisionOut(BaseModel):
    device: DeviceOut
    cert_bundle: dict[str, str]


# --- Telemetry ---
class TelemetryPoint(BaseModel):
    time: datetime
    temperature: float | None = None
    humidity: float | None = None
    vibration_hz: float | None = None
    power_w: float | None = None
    vib_rms_mm_s: float | None = None
    iso_zone: str | None = None
    sample_count: int = 1


# --- Alerts & Work Orders ---
class AlertUpdate(BaseModel):
    status: str = Field(pattern="^(open|acknowledged|in_progress|resolved|false_positive)$")
    resolution_notes: str | None = None


class AlertFeedback(BaseModel):
    feedback: int = Field(ge=-1, le=1)


class AlertOut(ORMBase):
    id: UUID
    org_id: UUID
    asset_id: UUID
    device_id: UUID | None
    severity: str
    status: str
    trigger_reason: str
    trigger_snapshot: dict[str, Any]
    ai_status: str
    ai_diagnosis: dict[str, Any] | None
    ai_feedback: int | None
    acknowledged_by: UUID | None
    acknowledged_at: datetime | None
    resolved_by: UUID | None
    resolved_at: datetime | None
    resolution_notes: str | None
    created_at: datetime


class WorkOrderCreate(BaseModel):
    asset_id: UUID
    alert_id: UUID | None = None
    title: str = Field(min_length=3, max_length=200)
    description: str | None = None
    priority: str = Field(default="high", pattern="^(low|medium|high|urgent)$")
    assigned_to: UUID | None = None


class WorkOrderUpdate(BaseModel):
    status: str | None = Field(default=None, pattern="^(open|in_progress|completed|cancelled)$")
    priority: str | None = Field(default=None, pattern="^(low|medium|high|urgent)$")
    description: str | None = None
    assigned_to: UUID | None = None


class WorkOrderOut(ORMBase):
    id: UUID
    org_id: UUID
    asset_id: UUID
    alert_id: UUID | None
    title: str
    description: str | None
    priority: str
    status: str
    assigned_to: UUID | None
    created_by: UUID | None
    completed_at: datetime | None
    created_at: datetime


# --- Manuals & Webhooks ---
class ManualOut(ORMBase):
    id: UUID
    org_id: UUID
    asset_id: UUID
    filename: str
    chunk_count: int
    created_at: datetime


class WebhookCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    url: str = Field(min_length=8, max_length=512)
    secret: str | None = None
    events: list[str] = Field(default_factory=lambda: ["alert.created", "device.offline"])


class WebhookOut(ORMBase):
    id: UUID
    org_id: UUID
    name: str
    url: str
    events: list[str]
    is_active: bool
    created_at: datetime


class AuditLogOut(ORMBase):
    id: UUID
    user_id: UUID | None
    action: str
    resource_type: str
    resource_id: str | None
    details: dict[str, Any]
    created_at: datetime
