"""
Async AI Diagnostic Copilot + pgvector Manual RAG + Multi-Channel Alert Notifier.
Consumes `alerts.enrich` from NATS JetStream so LLM latency NEVER touches MQTT ingestion.
Supports pluggable providers: mock | gemini | mistral | ollama (Zero AWS / Zero Cloudflare).
"""

import asyncio
import hashlib
import hmac
import json
import logging
from typing import Any, Literal
from uuid import UUID

import httpx
import nats
import redis.asyncio as aioredis
from pydantic import BaseModel, Field
from sqlalchemy import select, text, update

from app.config import get_settings
from app.db.session import AdminSessionLocal
from app.models.entities import Alert, Membership, Organization, User, Webhook
from app.services.embeddings import embed_text
from app.services.mailer import send_email

logging.basicConfig(level=logging.INFO, format="%(asctime)s [AI-COPILOT] %(levelname)s %(message)s")
logger = logging.getLogger("ai_worker")


class AIDiagnosis(BaseModel):
    severity_assessment: Literal["NORMAL", "WARNING", "CRITICAL"]
    summary: str = Field(max_length=500)
    probable_root_cause: str = Field(max_length=300)
    confidence: float = Field(ge=0.0, le=1.0)
    immediate_actions: list[str] = Field(min_length=1, max_length=5)
    safety_precaution: str = Field(max_length=250)
    cited_manual_section: str | None = None
    provider: str = "mock"


async def retrieve_manual_context(org_id: str, asset_id: str, query_text: str, k: int = 3) -> list[dict[str, str]]:
    """Retrieves top-k maintenance manual passages via pgvector cosine distance."""
    q_vec = embed_text(query_text)
    vec_literal = "[" + ",".join(f"{x:.6f}" for x in q_vec) + "]"
    async with AdminSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
                    SELECT section_title, content, 1 - (embedding <=> CAST(:qvec AS vector)) AS similarity
                    FROM manual_chunks
                    WHERE org_id = :org_id AND asset_id = :asset_id
                    ORDER BY embedding <=> CAST(:qvec AS vector)
                    LIMIT :k
                """),
                {"qvec": vec_literal, "org_id": UUID(org_id), "asset_id": UUID(asset_id), "k": k},
            )
        ).mappings().all()
    return [
        {
            "section": r["section_title"] or "General",
            "content": r["content"],
            "similarity": round(float(r["similarity"]), 3),
        }
        for r in rows
    ]


def build_deterministic_diagnosis(
    job: dict[str, Any], manual_hits: list[dict[str, str]], provider_label: str = "mock"
) -> AIDiagnosis:
    """Grounded, deterministic industrial diagnosis (used for mock mode AND as safe fallback on LLM outage)."""
    cur = job["current"]
    prof = job["profile"]
    sev = job["severity"]
    reason = job["trigger_reason"]

    d_temp = cur["temperature"] - prof["baseline_temp"]
    d_vib = cur["vibration_hz"] - prof["baseline_vibration_hz"]
    d_pwr = cur["power_w"] - prof["baseline_power_w"]
    iso_zone = cur.get("iso_zone", "B")

    cited = manual_hits[0]["section"] if manual_hits else None

    if d_vib >= prof["corr_vib_delta"] and d_temp >= prof["corr_temp_delta"] and d_pwr >= prof["corr_power_delta"]:
        root = "Progressive rolling-element bearing wear or shaft misalignment increasing mechanical friction"
        summary = (
            f"{job['asset_name']} shows correlated multi-signal elevation "
            f"(+{d_temp:.1f}°C, +{d_vib:.1f} Hz, +{d_pwr:.0f} W, ISO Zone {iso_zone}). "
            f"Simultaneous thermal, vibrational, and power load rise strongly indicates mechanical drag."
        )
        actions = [
            "Inspect drive-end and non-drive-end bearings with handheld vibrometer and IR thermography.",
            "Check lubrication condition and verify shaft coupling alignment tolerances.",
            "Schedule controlled bearing replacement before ISO Zone D structural damage occurs.",
        ]
        conf = 0.88
    elif cur["temperature"] >= prof["warn_temp"]:
        root = "Thermal overload, blocked cooling airflow, or stator winding overheating"
        summary = (
            f"{job['asset_name']} temperature reached {cur['temperature']:.1f}°C "
            f"({d_temp:+.1f}°C above baseline) triggering: {reason}."
        )
        actions = [
            "Verify cooling fan intake vents and heat-sink fins are clear of dust/debris.",
            "Measure phase currents with a clamp meter to check for voltage imbalance or single-phasing.",
            "Reduce mechanical load or transfer duty to standby unit if temperature continues rising.",
        ]
        conf = 0.82
    elif cur["vibration_hz"] >= prof["warn_vibration_hz"] or iso_zone in ("C", "D"):
        root = "Rotor unbalance, mechanical looseness, or bearing race defect"
        summary = (
            f"{job['asset_name']} vibration spiked to {cur['vibration_hz']:.1f} Hz "
            f"({cur.get('vib_rms_mm_s', '-')} mm/s RMS, ISO 20816 Zone {iso_zone})."
        )
        actions = [
            "Check baseplate mounting bolts and foundation grouting for mechanical looseness.",
            "Capture high-resolution FFT spectrum to distinguish 1x unbalance from bearing fault frequencies.",
            "Plan urgent inspection on next maintenance window." if iso_zone == "C" else "Initiate controlled shutdown immediately.",
        ]
        conf = 0.85
    else:
        root = "Electrical load anomaly or environmental drift"
        summary = f"{job['asset_name']} triggered {sev} alert ({reason}) with power at {cur['power_w']:.0f} W."
        actions = [
            "Inspect driven load for mechanical binding, jammed conveyors, or valve restriction.",
            "Check power supply quality and starter contactor terminals for high resistance.",
        ]
        conf = 0.76

    return AIDiagnosis(
        severity_assessment=sev if sev in ("WARNING", "CRITICAL") else "WARNING",
        summary=summary,
        probable_root_cause=root,
        confidence=conf,
        immediate_actions=actions,
        safety_precaution="Apply Lockout/Tagout (LOTO) and verify zero energy before opening guards or terminal boxes.",
        cited_manual_section=cited,
        provider=provider_label,
    )


def _build_llm_prompt(job: dict[str, Any], manual_hits: list[dict[str, str]]) -> str:
    manual_block = (
        "\n".join(f"[{m['section']}] {m['content']}" for m in manual_hits)
        if manual_hits
        else "No machine manual uploaded."
    )
    return (
        "You are a senior industrial reliability engineer AI copilot. "
        "Return ONLY valid JSON matching keys: severity_assessment (WARNING|CRITICAL), "
        "summary, probable_root_cause, confidence (0..1), immediate_actions (array of 2-4 concise steps), "
        "safety_precaution, cited_manual_section (string or null).\n\n"
        f"Asset: {job['asset_name']}\n"
        f"Rule Severity: {job['severity']}\n"
        f"Trigger: {job['trigger_reason']}\n"
        f"Current Metrics: {json.dumps(job['current'])}\n"
        f"Baselines: temp={job['profile']['baseline_temp']}C, vib={job['profile']['baseline_vibration_hz']}Hz, "
        f"power={job['profile']['baseline_power_w']}W\n"
        f"Recent History: {json.dumps(job['history'][-4:])}\n"
        f"Relevant Manual Excerpts:\n{manual_block}\n"
    )


async def run_llm(job: dict[str, Any], manual_hits: list[dict[str, str]]) -> tuple[AIDiagnosis, str]:
    settings = get_settings()
    provider = settings.llm_provider.lower().strip()

    if provider == "mock":
        return build_deterministic_diagnosis(job, manual_hits, "mock"), "completed"

    prompt = _build_llm_prompt(job, manual_hits)
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            if provider == "gemini" and settings.gemini_api_key:
                url = (
                    f"https://generativelanguage.googleapis.com/v1beta/models/"
                    f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}"
                )
                resp = await client.post(
                    url,
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {
                            "temperature": settings.llm_temperature,
                            "responseMimeType": "application/json",
                        },
                    },
                )
                resp.raise_for_status()
                raw_text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            elif provider == "mistral" and settings.mistral_api_key:
                resp = await client.post(
                    "https://api.mistral.ai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.mistral_api_key}"},
                    json={
                        "model": settings.mistral_model,
                        "temperature": settings.llm_temperature,
                        "response_format": {"type": "json_object"},
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                resp.raise_for_status()
                raw_text = resp.json()["choices"][0]["message"]["content"]
            elif provider == "ollama":
                resp = await client.post(
                    f"{settings.ollama_base_url}/api/chat",
                    json={
                        "model": settings.ollama_model,
                        "stream": False,
                        "format": "json",
                        "options": {"temperature": settings.llm_temperature},
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                resp.raise_for_status()
                raw_text = resp.json()["message"]["content"]
            else:
                return build_deterministic_diagnosis(job, manual_hits, "fallback-no-key"), "fallback"

        parsed = json.loads(raw_text)
        parsed["provider"] = provider
        return AIDiagnosis.model_validate(parsed), "completed"
    except Exception as exc:
        logger.warning("LLM provider '%s' failed (%s) — using deterministic fallback.", provider, exc)
        return build_deterministic_diagnosis(job, manual_hits, f"fallback({provider})"), "fallback"


async def notify_org(org_id: str, alert_data: dict[str, Any], diagnosis: AIDiagnosis) -> None:
    """Sends HTML alert emails to org engineers/admins (Mailpit locally) and fires active webhooks."""
    async with AdminSessionLocal() as db:
        org = (await db.execute(select(Organization).where(Organization.id == UUID(org_id)))).scalar_one_or_none()
        recipients = (
            await db.execute(
                select(User.email)
                .join(Membership, Membership.user_id == User.id)
                .where(
                    Membership.org_id == UUID(org_id),
                    Membership.role.in_(["owner", "admin", "engineer", "technician"]),
                    User.is_active.is_(True),
                )
            )
        ).scalars().all()
        webhooks = (
            await db.execute(
                select(Webhook).where(Webhook.org_id == UUID(org_id), Webhook.is_active.is_(True))
            )
        ).scalars().all()

    org_name = org.name if org else "Factory"
    actions_html = "".join(f"<li>{a}</li>" for a in diagnosis.immediate_actions)
    subject = f"[{alert_data['severity']}] {alert_data['asset_name']} — {org_name}"
    text_body = (
        f"Asset: {alert_data['asset_name']} ({org_name})\n"
        f"Severity: {alert_data['severity']}\n"
        f"Trigger: {alert_data['trigger_reason']}\n\n"
        f"AI Summary: {diagnosis.summary}\n"
        f"Probable Root Cause: {diagnosis.probable_root_cause}\n"
        f"Actions:\n" + "\n".join(f"- {a}" for a in diagnosis.immediate_actions) + "\n\n"
        f"Safety: {diagnosis.safety_precaution}\n"
    )
    html_body = (
        f"<h2>[{alert_data['severity']}] {alert_data['asset_name']}</h2>"
        f"<p><strong>Organization:</strong> {org_name}<br>"
        f"<strong>Trigger:</strong> {alert_data['trigger_reason']}</p>"
        f"<p><strong>AI Diagnosis ({diagnosis.provider}):</strong> {diagnosis.summary}</p>"
        f"<p><strong>Probable Root Cause:</strong> {diagnosis.probable_root_cause}</p>"
        f"<ul>{actions_html}</ul>"
        f"<p><em>Safety: {diagnosis.safety_precaution}</em></p>"
    )

    for email in recipients:
        send_email(email, subject, text_body, html_body)

    if webhooks:
        payload_bytes = json.dumps({"event": "alert.created", "alert": alert_data, "diagnosis": diagnosis.model_dump()}).encode()
        async with httpx.AsyncClient(timeout=5.0) as client:
            for wh in webhooks:
                if "alert.created" not in (wh.events or []):
                    continue
                headers = {"Content-Type": "application/json", "X-Eagle-Event": "alert.created"}
                if wh.secret:
                    sig = hmac.new(wh.secret.encode(), payload_bytes, hashlib.sha256).hexdigest()
                    headers["X-Eagle-Signature"] = f"sha256={sig}"
                try:
                    await client.post(wh.url, content=payload_bytes, headers=headers)
                except Exception as exc:
                    logger.warning("Webhook %s failed: %s", wh.name, exc)


async def run_ai_worker() -> None:
    settings = get_settings()
    valkey = aioredis.from_url(settings.valkey_url, decode_responses=True)
    nc = await nats.connect(settings.nats_url, reconnect_time_wait=2, max_reconnect_attempts=-1)
    js = nc.jetstream()
    try:
        await js.add_stream(name="ALERTS", subjects=["alerts.enrich"])
    except Exception:
        pass

    sub = await js.subscribe("alerts.enrich", durable="ai-copilot-v1")
    logger.info("AI Copilot Worker listening on `alerts.enrich` (provider=%s)...", settings.llm_provider)

    try:
        async for msg in sub.messages:
            try:
                job = json.loads(msg.data.decode("utf-8"))
                manual_hits = await retrieve_manual_context(
                    job["org_id"],
                    job["asset_id"],
                    f"{job['trigger_reason']} {job['asset_name']}",
                )
                diagnosis, ai_status = await run_llm(job, manual_hits)
                diag_dict = diagnosis.model_dump()

                async with AdminSessionLocal() as db:
                    await db.execute(
                        update(Alert)
                        .where(Alert.id == UUID(job["alert_id"]))
                        .values(ai_status=ai_status, ai_diagnosis=diag_dict)
                    )
                    await db.commit()

                updated_payload = {
                    "id": job["alert_id"],
                    "org_id": job["org_id"],
                    "asset_id": job["asset_id"],
                    "asset_name": job["asset_name"],
                    "severity": job["severity"],
                    "trigger_reason": job["trigger_reason"],
                    "ai_status": ai_status,
                    "ai_diagnosis": diag_dict,
                }
                await valkey.publish(
                    f"org:{job['org_id']}:events",
                    json.dumps({"type": "alert.updated", "data": updated_payload}),
                )
                await notify_org(job["org_id"], updated_payload, diagnosis)
                logger.info("Enriched alert %s (%s) -> %s", job["alert_id"], ai_status, diagnosis.probable_root_cause)
                await msg.ack()
            except Exception as exc:
                logger.exception("AI worker failed on message: %s", exc)
                await msg.ack()
    finally:
        await nc.close()
        await valkey.aclose()


if __name__ == "__main__":
    asyncio.run(run_ai_worker())
