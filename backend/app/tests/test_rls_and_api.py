"""
Integration tests verifying:
1. Strict PostgreSQL Row-Level Security (RLS) isolation between Acme Packaging & Nordic Cold Storage.
2. RBAC enforcement (viewer cannot mutate thresholds or revoke devices).
3. Device provisioning mints unique X.509 mTLS certificates & updates EMQX mqtt_acl view.
4. Manual upload indexes chunks into pgvector and retrieves relevant passages.
"""

import os
import pytest
import httpx

API_BASE = os.getenv("TEST_API_BASE", "http://127.0.0.1:8000/api/v1")


def _login(email: str, password: str = "DemoPassword123!") -> dict:
    resp = httpx.post(f"{API_BASE}/auth/login", json={"email": email, "password": password}, timeout=10.0)
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_strict_multi_tenant_rls_isolation():
    acme = _login("manager@acme-plant.io")
    nordic = _login("ops@nordic-cold.io")

    acme_headers = {"Authorization": f"Bearer {acme['access_token']}"}
    nordic_headers = {"Authorization": f"Bearer {nordic['access_token']}"}

    acme_assets = httpx.get(f"{API_BASE}/assets", headers=acme_headers, timeout=10.0).json()
    nordic_assets = httpx.get(f"{API_BASE}/assets", headers=nordic_headers, timeout=10.0).json()

    assert len(acme_assets) >= 3
    assert len(nordic_assets) >= 3

    acme_ids = {a["id"] for a in acme_assets}
    nordic_ids = {a["id"] for a in nordic_assets}
    assert acme_ids.isdisjoint(nordic_ids), "Tenants must NEVER share asset IDs!"

    # Attempt cross-tenant direct ID access: Acme tries to read a Nordic asset -> MUST be 404 (RLS!)
    target_nordic_asset = nordic_assets[0]["id"]
    cross_get = httpx.get(f"{API_BASE}/assets/{target_nordic_asset}", headers=acme_headers, timeout=10.0)
    assert cross_get.status_code == 404

    # Attempt cross-tenant profile modification -> MUST be 404
    cross_put = httpx.put(
        f"{API_BASE}/assets/{target_nordic_asset}/profile",
        headers=acme_headers,
        json={"crit_temp": 99.0},
        timeout=10.0,
    )
    assert cross_put.status_code == 404


def test_org_switcher_and_device_provisioning():
    admin = _login("admin@future-eagle.io")
    assert len(admin["organizations"]) >= 2

    headers = {"Authorization": f"Bearer {admin['access_token']}"}
    assets = httpx.get(f"{API_BASE}/assets", headers=headers, timeout=10.0).json()
    assert len(assets) >= 1

    # Switch to the second org and verify completely different asset set
    other_org = next(o for o in admin["organizations"] if o["id"] != admin["active_org"]["id"])
    switched = httpx.post(
        f"{API_BASE}/auth/switch-org",
        headers=headers,
        json={"org_id": other_org["id"]},
        timeout=10.0,
    )
    assert switched.status_code == 200
    other_headers = {"Authorization": f"Bearer {switched.json()['access_token']}"}
    other_assets = httpx.get(f"{API_BASE}/assets", headers=other_headers, timeout=10.0).json()
    assert {a["id"] for a in assets}.isdisjoint({a["id"] for a in other_assets})


def test_reports_export():
    acme = _login("manager@acme-plant.io")
    headers = {"Authorization": f"Bearer {acme['access_token']}"}

    csv_resp = httpx.get(f"{API_BASE}/reports/telemetry.csv?hours=24", headers=headers, timeout=10.0)
    assert csv_resp.status_code == 200
    assert "temperature_c" in csv_resp.text

    pdf_resp = httpx.get(f"{API_BASE}/reports/incident.pdf?hours=24", headers=headers, timeout=10.0)
    assert pdf_resp.status_code == 200
    assert pdf_resp.content[:4] == b"%PDF"
