from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from app.config import get_settings


def mint_device_certificate(org_slug: str, device_uid: str, days: int = 365) -> dict[str, str]:
    """Issues a unique X.509 client certificate signed by our Root CA with CN={org_slug}:{device_uid}."""
    settings = get_settings()
    certs_dir = Path(settings.certs_dir)
    ca_cert_path = certs_dir / "ca.crt"
    ca_key_path = certs_dir / "ca.key"

    ca_cert = x509.load_pem_x509_certificate(ca_cert_path.read_bytes())
    ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password=None)

    cn = f"{org_slug}:{device_uid}"
    device_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    now = datetime.now(timezone.utc)
    subject = x509.Name(
        [
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Future Eagle IIoT"),
            x509.NameAttribute(NameOID.COMMON_NAME, cn),
        ]
    )

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(ca_cert.subject)
        .public_key(device_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=days))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=True,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]),
            critical=False,
        )
        .sign(private_key=ca_key, algorithm=hashes.SHA256())
    )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")
    key_pem = device_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    ca_pem = ca_cert_path.read_text(encoding="utf-8")
    fingerprint = cert.fingerprint(hashes.SHA256()).hex()

    # Persist local dev copy for simulator convenience
    devices_dir = certs_dir / "devices"
    if devices_dir.exists() or certs_dir.exists():
        try:
            devices_dir.mkdir(parents=True, exist_ok=True)
            prefix = devices_dir / f"{org_slug}__{device_uid}"
            prefix.with_suffix(".crt").write_text(cert_pem, encoding="utf-8")
            prefix.with_suffix(".key").write_text(key_pem, encoding="utf-8")
        except OSError:
            pass

    return {
        "cert_cn": cn,
        "fingerprint": fingerprint,
        "ca_crt": ca_pem,
        "client_crt": cert_pem,
        "client_key": key_pem,
        "mqtt_topic_telemetry": f"tenants/{org_slug}/devices/{device_uid}/telemetry",
        "mqtt_topic_status": f"tenants/{org_slug}/devices/{device_uid}/status",
        "mqtt_topic_cmd": f"tenants/{org_slug}/devices/{device_uid}/cmd",
    }
