#!/usr/bin/env bash
set -euo pipefail

# Future Eagle IIoT — SAN-Compliant X.509 PKI Generator for Localhost mTLS
# Usage:
#   ./infra/scripts/generate_certs.sh                   # Generate Root CA, EMQX broker cert, ingestor service cert
#   ./infra/scripts/generate_certs.sh device <org> <id> # Mint a per-device mTLS client cert (CN=<org>:<id>)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CERT_DIR="${CERT_DIR:-$ROOT_DIR/infra/certs}"
DEVICES_DIR="$CERT_DIR/devices"
mkdir -p "$CERT_DIR" "$DEVICES_DIR"

detect_lan_ip() {
  hostname -I 2>/dev/null | awk '{print $1}' || true
}

generate_ca() {
  if [[ -f "$CERT_DIR/ca.crt" && -f "$CERT_DIR/ca.key" ]]; then
    echo "[PKI] Root CA already exists at $CERT_DIR/ca.crt"
    return
  fi
  echo "[PKI] Generating Root CA..."
  local ca_ext="$CERT_DIR/.ca.ext"
  cat > "$ca_ext" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[dn]
C = PT
O = Future Eagle IIoT
CN = FutureEagleRootCA

[v3_ca]
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always,issuer
basicConstraints = critical, CA:true, pathlen:1
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
EOF
  openssl genrsa -out "$CERT_DIR/ca.key" 2048 2>/dev/null
  openssl req -x509 -new -nodes -key "$CERT_DIR/ca.key" -sha256 -days 3650 \
    -out "$CERT_DIR/ca.crt" -config "$ca_ext"
  rm -f "$ca_ext"
  chmod 644 "$CERT_DIR/ca.crt" "$CERT_DIR/ca.key"
  echo "[PKI] Root CA created."
}

generate_broker() {
  local lan_ip="${EXTRA_SAN_IP:-$(detect_lan_ip)}"
  local san="DNS:localhost,DNS:emqx,DNS:mqtt.localhost,IP:127.0.0.1"
  if [[ -n "$lan_ip" ]]; then
    san="${san},IP:${lan_ip}"
  fi
  echo "[PKI] Generating SAN-compliant broker certificate ($san)..."
  local broker_ext="$CERT_DIR/.broker.ext"
  cat > "$broker_ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = ${san}
EOF
  openssl genrsa -out "$CERT_DIR/broker.key" 2048 2>/dev/null
  openssl req -new -key "$CERT_DIR/broker.key" -subj "/O=Future Eagle IIoT/CN=emqx" \
    -out "$CERT_DIR/broker.csr"
  openssl x509 -req -in "$CERT_DIR/broker.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -out "$CERT_DIR/broker.crt" -days 825 -sha256 -extfile "$broker_ext" 2>/dev/null
  rm -f "$CERT_DIR/broker.csr" "$broker_ext"
  chmod 644 "$CERT_DIR/broker.crt" "$CERT_DIR/broker.key"
  echo "[PKI] Broker cert created."
}

generate_client_cert() {
  local cn="$1"
  local out_prefix="$2"
  echo "[PKI] Minting client cert CN=$cn -> ${out_prefix}.{crt,key}"
  local client_ext="$CERT_DIR/.client.ext"
  cat > "$client_ext" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF
  openssl genrsa -out "${out_prefix}.key" 2048 2>/dev/null
  openssl req -new -key "${out_prefix}.key" -subj "/O=Future Eagle IIoT/CN=${cn}" \
    -out "${out_prefix}.csr"
  openssl x509 -req -in "${out_prefix}.csr" \
    -CA "$CERT_DIR/ca.crt" -CAkey "$CERT_DIR/ca.key" -CAcreateserial \
    -out "${out_prefix}.crt" -days 365 -sha256 -extfile "$client_ext" 2>/dev/null
  rm -f "${out_prefix}.csr" "$client_ext"
  chmod 644 "${out_prefix}.crt" "${out_prefix}.key"
}

if [[ "${1:-}" == "device" ]]; then
  if [[ $# -ne 3 ]]; then
    echo "Usage: $0 device <org_slug> <device_uid>" >&2
    exit 1
  fi
  generate_ca
  ORG_SLUG="$2"
  DEVICE_UID="$3"
  generate_client_cert "${ORG_SLUG}:${DEVICE_UID}" "$DEVICES_DIR/${ORG_SLUG}__${DEVICE_UID}"
  exit 0
fi

generate_ca
generate_broker
generate_client_cert "service:ingestor" "$CERT_DIR/ingestor"
echo "[PKI] Done. Certificates stored in $CERT_DIR"
