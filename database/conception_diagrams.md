# Database Conception — ER Model (MLD) & UML Class Diagram

This document captures the full relational and domain conception for the **Future Eagle IIoT SaaS** database implemented in [schema.sql](./schema.sql) and [entities.py](../backend/app/models/entities.py).

---

## 1. Entity-Relationship Diagram (MLD)

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ MEMBERSHIPS : "has"
    USERS ||--o{ MEMBERSHIPS : "joins"
    ORGANIZATIONS ||--o{ INVITATIONS : "issues"
    USERS ||--o{ INVITATIONS : "sends"

    ORGANIZATIONS ||--o{ SITES : "owns"
    SITES ||--o{ PRODUCTION_LINES : "contains"
    ORGANIZATIONS ||--o{ PRODUCTION_LINES : "scopes"
    SITES ||--o{ ASSETS : "houses"
    PRODUCTION_LINES ||--o{ ASSETS : "groups"
    ORGANIZATIONS ||--o{ ASSETS : "scopes"

    ASSETS ||--|| ASSET_PROFILES : "configured_by"
    ASSETS ||--o{ DEVICES : "monitored_by"
    ORGANIZATIONS ||--o{ DEVICES : "scopes"

    DEVICES ||--o{ SENSOR_READINGS : "emits"
    ASSETS ||--o{ SENSOR_READINGS : "records"
    ORGANIZATIONS ||--o{ SENSOR_READINGS : "partitions"

    ASSETS ||--o{ ALERTS : "triggers"
    DEVICES ||--o{ ALERTS : "sources"
    USERS ||--o{ ALERTS : "acknowledges_resolves"

    ASSETS ||--o{ WORK_ORDERS : "targets"
    ALERTS ||--o{ WORK_ORDERS : "escalates_to"
    USERS ||--o{ WORK_ORDERS : "creates_assigned"

    ASSETS ||--o{ ASSET_MANUALS : "documented_by"
    ASSET_MANUALS ||--o{ MANUAL_CHUNKS : "splits_into"
    ASSETS ||--o{ MANUAL_CHUNKS : "indexed_for"

    ORGANIZATIONS ||--o{ WEBHOOKS : "configures"
    ORGANIZATIONS ||--o{ AUDIT_LOGS : "records"
    USERS ||--o{ AUDIT_LOGS : "performs"

    ORGANIZATIONS {
        uuid id PK
        varchar name
        varchar slug UK
        varchar plan_tier
        timestamptz created_at
    }
    USERS {
        uuid id PK
        varchar email UK
        varchar full_name
        text password_hash
        boolean is_active
        timestamptz created_at
    }
    MEMBERSHIPS {
        uuid id PK
        uuid org_id FK
        uuid user_id FK
        varchar role
        timestamptz created_at
    }
    INVITATIONS {
        uuid id PK
        uuid org_id FK
        varchar email
        varchar role
        varchar token UK
        uuid invited_by FK
        timestamptz accepted_at
        timestamptz expires_at
    }
    SITES {
        uuid id PK
        uuid org_id FK
        varchar name
        varchar location
        varchar timezone
    }
    PRODUCTION_LINES {
        uuid id PK
        uuid org_id FK
        uuid site_id FK
        varchar name
        text description
    }
    ASSETS {
        uuid id PK
        uuid org_id FK
        uuid site_id FK
        uuid line_id FK
        varchar name
        varchar asset_type
        varchar health_status
        boolean maintenance_mode
        jsonb latest_metrics
    }
    ASSET_PROFILES {
        uuid id PK
        uuid org_id FK
        uuid asset_id FK
        float baseline_temp
        float crit_temp
        float baseline_vibration_hz
        float crit_vibration_hz
        float baseline_power_w
        float crit_power_w
        int cooldown_base_sec
    }
    DEVICES {
        uuid id PK
        uuid org_id FK
        uuid asset_id FK
        varchar device_uid
        varchar cert_cn UK
        varchar cert_fingerprint
        boolean is_revoked
        varchar status
    }
    SENSOR_READINGS {
        timestamptz time PK
        uuid org_id PK
        uuid device_id PK
        uuid asset_id
        float temperature
        float humidity
        float vibration_hz
        float power_w
        float vib_rms_mm_s
        varchar iso_zone
        jsonb metadata
    }
    ALERTS {
        uuid id PK
        uuid org_id FK
        uuid asset_id FK
        uuid device_id FK
        varchar severity
        varchar status
        text trigger_reason
        jsonb trigger_snapshot
        varchar ai_status
        jsonb ai_diagnosis
        smallint ai_feedback
    }
    WORK_ORDERS {
        uuid id PK
        uuid org_id FK
        uuid asset_id FK
        uuid alert_id FK
        varchar title
        varchar priority
        varchar status
        uuid assigned_to FK
        uuid created_by FK
    }
    ASSET_MANUALS {
        uuid id PK
        uuid org_id FK
        uuid asset_id FK
        varchar filename
        varchar storage_key
        int chunk_count
        uuid uploaded_by FK
    }
    MANUAL_CHUNKS {
        uuid id PK
        uuid org_id FK
        uuid manual_id FK
        uuid asset_id FK
        int chunk_index
        varchar section_title
        text content
        vector embedding
    }
    WEBHOOKS {
        uuid id PK
        uuid org_id FK
        varchar name
        varchar url
        varchar secret
        jsonb events
        boolean is_active
    }
    AUDIT_LOGS {
        uuid id PK
        uuid org_id FK
        uuid user_id FK
        varchar action
        varchar resource_type
        varchar resource_id
        jsonb details
    }
```

---

## 2. UML Class Diagram (Domain & ORM Entities)

```mermaid
classDiagram
    class Organization {
        +UUID id
        +str name
        +str slug
        +str plan_tier
        +datetime created_at
    }
    class User {
        +UUID id
        +str email
        +str full_name
        +str password_hash
        +bool is_active
        +datetime created_at
    }
    class Membership {
        +UUID id
        +UUID org_id
        +UUID user_id
        +str role
        +datetime created_at
    }
    class Invitation {
        +UUID id
        +UUID org_id
        +str email
        +str role
        +str token
        +UUID invited_by
        +datetime accepted_at
        +datetime expires_at
    }
    class Site {
        +UUID id
        +UUID org_id
        +str name
        +str location
        +str timezone
    }
    class ProductionLine {
        +UUID id
        +UUID org_id
        +UUID site_id
        +str name
        +str description
    }
    class Asset {
        +UUID id
        +UUID org_id
        +UUID site_id
        +UUID line_id
        +str name
        +str asset_type
        +str manufacturer
        +str model_number
        +float rated_power_kw
        +int rated_rpm
        +str health_status
        +bool maintenance_mode
        +datetime last_telemetry_at
        +dict latest_metrics
    }
    class AssetProfile {
        +UUID id
        +UUID org_id
        +UUID asset_id
        +float baseline_temp
        +float warn_temp
        +float crit_temp
        +float baseline_vibration_hz
        +float crit_vibration_hz
        +float baseline_power_w
        +float crit_power_w
        +int corr_min_signals
        +int cooldown_base_sec
        +int cooldown_max_sec
    }
    class Device {
        +UUID id
        +UUID org_id
        +UUID asset_id
        +str device_uid
        +str protocol
        +str firmware_version
        +str cert_cn
        +str cert_fingerprint
        +bool is_revoked
        +str status
        +datetime last_seen_at
    }
    class SensorReading {
        +datetime time
        +UUID org_id
        +UUID device_id
        +UUID asset_id
        +float temperature
        +float humidity
        +float vibration_hz
        +float power_w
        +float vib_rms_mm_s
        +str iso_zone
        +dict extra_metadata
    }
    class Alert {
        +UUID id
        +UUID org_id
        +UUID asset_id
        +UUID device_id
        +str severity
        +str status
        +str trigger_reason
        +dict trigger_snapshot
        +str ai_status
        +dict ai_diagnosis
        +int ai_feedback
        +str resolution_notes
    }
    class WorkOrder {
        +UUID id
        +UUID org_id
        +UUID asset_id
        +UUID alert_id
        +str title
        +str description
        +str priority
        +str status
        +UUID assigned_to
        +UUID created_by
    }
    class AssetManual {
        +UUID id
        +UUID org_id
        +UUID asset_id
        +str filename
        +str storage_key
        +int chunk_count
    }
    class ManualChunk {
        +UUID id
        +UUID org_id
        +UUID manual_id
        +UUID asset_id
        +int chunk_index
        +str section_title
        +str content
        +vector_384 embedding
    }
    class Webhook {
        +UUID id
        +UUID org_id
        +str name
        +str url
        +str secret
        +list events
        +bool is_active
    }
    class AuditLog {
        +UUID id
        +UUID org_id
        +UUID user_id
        +str action
        +str resource_type
        +str resource_id
        +dict details
    }

    Organization "1" --> "*" Membership
    User "1" --> "*" Membership
    Organization "1" --> "*" Invitation
    Organization "1" --> "*" Site
    Site "1" --> "*" ProductionLine
    Site "1" --> "*" Asset
    ProductionLine "1" --> "*" Asset
    Asset "1" -- "1" AssetProfile
    Asset "1" --> "*" Device
    Device "1" --> "*" SensorReading
    Asset "1" --> "*" Alert
    Alert "1" --> "0..*" WorkOrder
    Asset "1" --> "*" AssetManual
    AssetManual "1" --> "*" ManualChunk
    Organization "1" --> "*" Webhook
    Organization "1" --> "*" AuditLog
```

---

## 3. Three-Layer Multi-Tenancy & Security Model

1. **MQTT Broker Layer (EMQX `mqtt_acl` view):** Every edge device connects with a unique X.509 mTLS certificate whose Common Name (`CN`) is `{org_slug}:{device_uid}`. EMQX reads the live `mqtt_acl` SQL view and disconnects any device attempting to publish/subscribe outside `tenants/{org_slug}/devices/{device_uid}/#` or any device with `is_revoked = true`.
2. **API & RBAC Layer (FastAPI):** Every HTTP/WebSocket request validates a signed JWT (`org_id`, `role`), checks active `memberships`, and enforces role thresholds (`viewer < technician < engineer < admin < owner`).
3. **Database Layer (PostgreSQL Row-Level Security):** The API connects as the non-superuser `eagle_app` role and executes `SET LOCAL app.current_org_id = '<org_uuid>'` inside each transaction. All 13 tenant tables enforce `FORCE ROW LEVEL SECURITY`, making cross-tenant reads or mutations impossible even if a query omits a `WHERE org_id = ...` filter.
