#pragma once

// Copy this file to `secrets.h` (gitignored!) and fill with your local Wi-Fi
// and the unique X.509 mTLS bundle provisioned in the Web Control Room (Devices & PKI tab).

static const char* WIFI_SSID     = "YOUR_FACTORY_WIFI";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Your localhost workstation LAN IP (included in broker.crt SAN!) or production broker domain
static const char* MQTT_BROKER   = "192.168.1.116";
static const int   MQTT_PORT     = 8883;

// Multi-tenant identity — MUST match the X.509 Client Certificate CN: "{ORG_SLUG}:{DEVICE_UID}"
static const char* ORG_SLUG      = "acme-packaging";
static const char* DEVICE_UID    = "acme-motor-01";

// Paste contents of infra/certs/ca.crt
static const char* CA_CERT_PEM = R"EOF(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_CA_CERT
-----END CERTIFICATE-----
)EOF";

// Paste contents of infra/certs/devices/<org>__<device_uid>.crt
static const char* CLIENT_CERT_PEM = R"EOF(
-----BEGIN CERTIFICATE-----
REPLACE_WITH_DEVICE_CERT
-----END CERTIFICATE-----
)EOF";

// Paste contents of infra/certs/devices/<org>__<device_uid>.key
static const char* CLIENT_KEY_PEM = R"EOF(
-----BEGIN RSA PRIVATE KEY-----
REPLACE_WITH_DEVICE_PRIVATE_KEY
-----END RSA PRIVATE KEY-----
)EOF";
