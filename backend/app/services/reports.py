import csv
import io
from datetime import datetime, timezone

from fpdf import FPDF


def build_telemetry_csv(rows: list[dict]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["time", "asset_id", "temperature_c", "humidity_pct", "vibration_hz", "power_w", "vib_rms_mm_s", "iso_zone"]
    )
    for r in rows:
        writer.writerow(
            [
                r["time"].isoformat() if hasattr(r["time"], "isoformat") else r["time"],
                r.get("asset_id", ""),
                r.get("temperature", ""),
                r.get("humidity", ""),
                r.get("vibration_hz", ""),
                r.get("power_w", ""),
                r.get("vib_rms_mm_s", ""),
                r.get("iso_zone", ""),
            ]
        )
    return buf.getvalue().encode("utf-8")


def _safe(text: str) -> str:
    return (text or "").encode("latin-1", "replace").decode("latin-1")


def build_incident_pdf(
    org_name: str,
    assets: list[dict],
    alerts: list[dict],
    period_hours: int = 24,
) -> bytes:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, _safe(f"Future Eagle IIoT - Fleet Health & Incident Report"), ln=True)

    pdf.set_font("Helvetica", "", 10)
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    pdf.cell(0, 6, _safe(f"Organization: {org_name}  |  Window: Last {period_hours}h  |  Generated: {now_str}"), ln=True)
    pdf.ln(4)

    open_count = sum(1 for a in alerts if a.get("status") not in ("resolved", "false_positive"))
    crit_count = sum(1 for a in alerts if a.get("severity") == "CRITICAL")
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Executive Summary", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(
        0,
        6,
        _safe(
            f"Monitored Assets: {len(assets)}   |   Alerts ({period_hours}h): {len(alerts)}   |   "
            f"Critical: {crit_count}   |   Open: {open_count}"
        ),
        ln=True,
    )
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Asset Health Overview", ln=True)
    pdf.set_font("Helvetica", "", 9)
    for asset in assets[:25]:
        metrics = asset.get("latest_metrics") or {}
        line = (
            f"- {asset['name']} ({asset['asset_type']}) | Status: {asset['health_status']} | "
            f"T: {metrics.get('temperature', '-')} C | Vib: {metrics.get('vibration_hz', '-')} Hz | "
            f"Power: {metrics.get('power_w', '-')} W"
        )
        pdf.multi_cell(0, 5, _safe(line))
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Recent Alerts & AI Diagnostics", ln=True)
    pdf.set_font("Helvetica", "", 9)
    if not alerts:
        pdf.cell(0, 6, "No alerts recorded in the selected window.", ln=True)
    else:
        for alert in alerts[:30]:
            created = alert.get("created_at")
            ts = created.strftime("%Y-%m-%d %H:%M") if hasattr(created, "strftime") else str(created)
            diag = alert.get("ai_diagnosis") or {}
            summary = diag.get("summary") or alert.get("trigger_reason") or ""
            pdf.set_font("Helvetica", "B", 9)
            pdf.multi_cell(
                0,
                5,
                _safe(f"[{alert['severity']}] {ts} | Status: {alert['status']} | {alert['trigger_reason']}"),
            )
            pdf.set_font("Helvetica", "", 9)
            if summary:
                pdf.multi_cell(0, 5, _safe(f"   AI Diagnosis: {summary}"))
            pdf.ln(1)

    return bytes(pdf.output())
