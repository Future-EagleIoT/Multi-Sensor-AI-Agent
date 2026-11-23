"""
Idempotent local development seeder:
Creates 2 isolated industrial SaaS tenants (Acme Packaging & Nordic Cold Storage),
sites, production lines, 6 distinct machines with realistic profiles, 6 mTLS-provisioned
devices (with real X.509 client certificates), and pre-indexed maintenance manuals in pgvector.
"""

import asyncio
import logging

from sqlalchemy import select

from app.auth.security import hash_password
from app.db.session import AdminSessionLocal
from app.models.entities import (
    Asset,
    AssetManual,
    AssetProfile,
    Device,
    ManualChunk,
    Membership,
    Organization,
    ProductionLine,
    Site,
    User,
)
from app.services.embeddings import chunk_manual_text, embed_text
from app.services.pki import mint_device_certificate

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SEED] %(message)s")
logger = logging.getLogger("seed")

SAMPLE_MOTOR_MANUAL = """
# Section 1: Operating Limits & Thermal Protection
Siemens 1LE1 Three-Phase Induction Motor (15 kW, 1470 RPM, Class F Insulation).
Normal housing temperature during continuous S1 load: 28-34 C (lab) / 55-75 C (heavy duty).
If housing temperature rises above 37 C rapidly (>3 C in 15s), immediately inspect cooling cowl,
fan blades, and check for phase voltage imbalance exceeding 2%.

# Section 2: Bearing Maintenance & Vibration Limits (ISO 20816-3)
Drive-End Bearing: SKF 6309-2Z C3. Non-Drive-End Bearing: SKF 6209-2Z C3.
Re-grease interval: every 4,000 operating hours with Mobil Polyrex EM (18 grams).
Simultaneous rise in vibration (>14 Hz / >4.5 mm/s RMS), housing temperature (+5 C), and power draw (+16 W)
is the hallmark signature of inner-race bearing spalling or shaft coupling misalignment.
Stop unit immediately if vibration enters ISO 20816 Zone D (>11.2 mm/s RMS).

# Section 3: Lockout/Tagout & Electrical Safety
Before opening the terminal box or coupling guard, isolate main circuit breaker CB-14,
apply personal LOTO padlock, verify zero voltage across L1-L2-L3, and wait 5 minutes for VFD DC bus discharge.
"""

SAMPLE_COMPRESSOR_MANUAL = """
# Section 1: Cold-Storage Ammonia Screw Compressor Limits
Bitzer OSKA-74 Screw Compressor (45 kW, 2950 RPM).
Nominal suction humidity 40-65%, casing baseline 26-32 C, baseline vibration 10-13 Hz, nominal load 110 W (scaled bench).
High power draw combined with rising discharge temperature indicates fouled condenser coils or oil-cooler blockage.

# Section 2: Shaft Seal & Bearing Inspection
Check mechanical shaft seal oil reservoir level weekly. Rising vibration above 18 Hz with elevated power draw
suggests rotor contact or thrust bearing degradation. Verify oil differential pressure > 2.5 bar before restart.
"""

TENANTS = [
    {
        "org_name": "Acme Packaging Co.",
        "org_slug": "acme-packaging",
        "email": "manager@acme-plant.io",
        "full_name": "Elena Rostova (Acme Plant Mgr)",
        "password": "DemoPassword123!",
        "site_name": "Porto Packaging Plant",
        "site_location": "Porto, Portugal",
        "line_name": "Bottling Line A",
        "manual_name": "Siemens_1LE1_Motor_Manual.md",
        "manual_text": SAMPLE_MOTOR_MANUAL,
        "assets": [
            {
                "name": "Conveyor Drive Motor #1",
                "asset_type": "motor",
                "manufacturer": "Siemens",
                "model_number": "1LE1001-1CB2",
                "rated_power_kw": 15.0,
                "rated_rpm": 1470,
                "device_uid": "acme-motor-01",
                "profile": {
                    "baseline_temp": 30.0,
                    "baseline_vibration_hz": 12.0,
                    "baseline_power_w": 85.0,
                    "warn_temp": 35.0,
                    "crit_temp": 37.0,
                    "warn_vibration_hz": 17.0,
                    "crit_vibration_hz": 20.0,
                    "warn_power_w": 115.0,
                    "crit_power_w": 130.0,
                },
            },
            {
                "name": "Bottle Filler Main Pump",
                "asset_type": "pump",
                "manufacturer": "Grundfos",
                "model_number": "CRN 32-4",
                "rated_power_kw": 11.0,
                "rated_rpm": 2900,
                "device_uid": "acme-pump-02",
                "profile": {
                    "baseline_temp": 31.0,
                    "baseline_vibration_hz": 11.0,
                    "baseline_power_w": 92.0,
                    "warn_temp": 36.0,
                    "crit_temp": 39.0,
                    "warn_vibration_hz": 16.5,
                    "crit_vibration_hz": 19.5,
                    "warn_power_w": 122.0,
                    "crit_power_w": 140.0,
                },
            },
            {
                "name": "Palletizer Hydraulic Motor",
                "asset_type": "motor",
                "manufacturer": "ABB",
                "model_number": "M3BP 160MLB",
                "rated_power_kw": 18.5,
                "rated_rpm": 1480,
                "device_uid": "acme-motor-03",
                "profile": {
                    "baseline_temp": 29.5,
                    "baseline_vibration_hz": 12.5,
                    "baseline_power_w": 88.0,
                    "warn_temp": 35.5,
                    "crit_temp": 38.0,
                    "warn_vibration_hz": 17.5,
                    "crit_vibration_hz": 20.5,
                    "warn_power_w": 118.0,
                    "crit_power_w": 135.0,
                },
            },
        ],
    },
    {
        "org_name": "Nordic Cold Storage",
        "org_slug": "nordic-cold",
        "email": "ops@nordic-cold.io",
        "full_name": "Soren Lindqvist (Nordic Reliability Eng)",
        "password": "DemoPassword123!",
        "site_name": "Gothenburg Cold Hub",
        "site_location": "Gothenburg, Sweden",
        "line_name": "Blast Freezer Bank 1",
        "manual_name": "Bitzer_OSKA74_Compressor_Manual.md",
        "manual_text": SAMPLE_COMPRESSOR_MANUAL,
        "assets": [
            {
                "name": "Ammonia Screw Compressor #1",
                "asset_type": "compressor",
                "manufacturer": "Bitzer",
                "model_number": "OSKA-7461-K",
                "rated_power_kw": 45.0,
                "rated_rpm": 2950,
                "device_uid": "nordic-comp-01",
                "profile": {
                    "baseline_temp": 28.0,
                    "baseline_vibration_hz": 11.5,
                    "baseline_power_w": 110.0,
                    "warn_temp": 34.0,
                    "crit_temp": 36.5,
                    "warn_vibration_hz": 16.5,
                    "crit_vibration_hz": 19.5,
                    "warn_power_w": 140.0,
                    "crit_power_w": 160.0,
                },
            },
            {
                "name": "Evaporator Condenser Fan A",
                "asset_type": "fan",
                "manufacturer": "ebm-papst",
                "model_number": "W3G910",
                "rated_power_kw": 7.5,
                "rated_rpm": 980,
                "device_uid": "nordic-fan-02",
                "profile": {
                    "baseline_temp": 26.0,
                    "baseline_vibration_hz": 10.0,
                    "baseline_power_w": 65.0,
                    "warn_temp": 32.0,
                    "crit_temp": 35.0,
                    "warn_vibration_hz": 15.5,
                    "crit_vibration_hz": 18.5,
                    "warn_power_w": 90.0,
                    "crit_power_w": 105.0,
                },
            },
            {
                "name": "Glycol Chiller Loop Pump",
                "asset_type": "chiller",
                "manufacturer": "KSB",
                "model_number": "Etanorm 80-65",
                "rated_power_kw": 22.0,
                "rated_rpm": 1475,
                "device_uid": "nordic-chill-03",
                "profile": {
                    "baseline_temp": 27.5,
                    "baseline_vibration_hz": 11.0,
                    "baseline_power_w": 95.0,
                    "warn_temp": 33.5,
                    "crit_temp": 36.0,
                    "warn_vibration_hz": 16.0,
                    "crit_vibration_hz": 19.0,
                    "warn_power_w": 125.0,
                    "crit_power_w": 145.0,
                },
            },
        ],
    },
]


async def seed() -> None:
    async with AdminSessionLocal() as db:
        # Also create a super-demo user who belongs to BOTH orgs so you can test Org Switcher!
        dual_email = "admin@future-eagle.io"
        dual_user = (await db.execute(select(User).where(User.email == dual_email))).scalar_one_or_none()
        if not dual_user:
            dual_user = User(
                email=dual_email,
                full_name="Platform Admin (Multi-Factory Demo)",
                password_hash=hash_password("DemoPassword123!"),
            )
            db.add(dual_user)
            await db.flush()

        for t in TENANTS:
            org = (await db.execute(select(Organization).where(Organization.slug == t["org_slug"]))).scalar_one_or_none()
            if not org:
                org = Organization(name=t["org_name"], slug=t["org_slug"], plan_tier="pro")
                db.add(org)
                await db.flush()
                logger.info("Created org: %s (%s)", org.name, org.slug)

            user = (await db.execute(select(User).where(User.email == t["email"]))).scalar_one_or_none()
            if not user:
                user = User(
                    email=t["email"],
                    full_name=t["full_name"],
                    password_hash=hash_password(t["password"]),
                )
                db.add(user)
                await db.flush()

            for u_obj, role in [(user, "owner"), (dual_user, "owner")]:
                mem = (
                    await db.execute(
                        select(Membership).where(Membership.org_id == org.id, Membership.user_id == u_obj.id)
                    )
                ).scalar_one_or_none()
                if not mem:
                    db.add(Membership(org_id=org.id, user_id=u_obj.id, role=role))

            site = (
                await db.execute(select(Site).where(Site.org_id == org.id, Site.name == t["site_name"]))
            ).scalar_one_or_none()
            if not site:
                site = Site(org_id=org.id, name=t["site_name"], location=t["site_location"])
                db.add(site)
                await db.flush()

            line = (
                await db.execute(
                    select(ProductionLine).where(
                        ProductionLine.org_id == org.id, ProductionLine.name == t["line_name"]
                    )
                )
            ).scalar_one_or_none()
            if not line:
                line = ProductionLine(org_id=org.id, site_id=site.id, name=t["line_name"])
                db.add(line)
                await db.flush()

            for a_spec in t["assets"]:
                asset = (
                    await db.execute(
                        select(Asset).where(Asset.org_id == org.id, Asset.name == a_spec["name"])
                    )
                ).scalar_one_or_none()
                if not asset:
                    asset = Asset(
                        org_id=org.id,
                        site_id=site.id,
                        line_id=line.id,
                        name=a_spec["name"],
                        asset_type=a_spec["asset_type"],
                        manufacturer=a_spec["manufacturer"],
                        model_number=a_spec["model_number"],
                        rated_power_kw=a_spec["rated_power_kw"],
                        rated_rpm=a_spec["rated_rpm"],
                    )
                    db.add(asset)
                    await db.flush()

                    db.add(AssetProfile(org_id=org.id, asset_id=asset.id, **a_spec["profile"]))

                    # Index sample manual into pgvector so RAG works immediately!
                    chunks = chunk_manual_text(t["manual_text"])
                    manual = AssetManual(
                        org_id=org.id,
                        asset_id=asset.id,
                        filename=t["manual_name"],
                        storage_key=f"tenants/{org.slug}/manuals/{asset.id}/{t['manual_name']}",
                        chunk_count=len(chunks),
                        uploaded_by=user.id,
                    )
                    db.add(manual)
                    await db.flush()
                    for idx, (sec, content) in enumerate(chunks):
                        db.add(
                            ManualChunk(
                                org_id=org.id,
                                manual_id=manual.id,
                                asset_id=asset.id,
                                chunk_index=idx,
                                section_title=sec,
                                content=content,
                                embedding=embed_text(f"{sec}\n{content}"),
                            )
                        )

                dev = (
                    await db.execute(
                        select(Device).where(Device.org_id == org.id, Device.device_uid == a_spec["device_uid"])
                    )
                ).scalar_one_or_none()
                if not dev:
                    cert_bundle = mint_device_certificate(org.slug, a_spec["device_uid"])
                    dev = Device(
                        org_id=org.id,
                        asset_id=asset.id,
                        device_uid=a_spec["device_uid"],
                        protocol="mqtt",
                        firmware_version="2.0.0",
                        cert_cn=cert_bundle["cert_cn"],
                        cert_fingerprint=cert_bundle["fingerprint"],
                        status="provisioned",
                    )
                    db.add(dev)
                    logger.info("Provisioned device %s with mTLS cert CN=%s", dev.device_uid, dev.cert_cn)

        await db.commit()
    logger.info("Seed complete!")
    logger.info("Demo logins (password: DemoPassword123!):")
    logger.info("  - Multi-factory admin: admin@future-eagle.io")
    logger.info("  - Acme Packaging only: manager@acme-plant.io")
    logger.info("  - Nordic Cold only:    ops@nordic-cold.io")


if __name__ == "__main__":
    asyncio.run(seed())
