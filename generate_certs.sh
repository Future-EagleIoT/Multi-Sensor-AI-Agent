#!/bin/bash

# Directory for certificates
CERT_DIR="./mosquitto/config/certs"
mkdir -p $CERT_DIR

# 1. Generate CA (Certificate Authority)
openssl genrsa -out $CERT_DIR/ca.key 2048
openssl req -new -x509 -days 3650 -key $CERT_DIR/ca.key -out $CERT_DIR/ca.crt -subj "/CN=MultiSensorCA"

# 2. Generate Broker Certificate
openssl genrsa -out $CERT_DIR/broker.key 2048
openssl req -new -key $CERT_DIR/broker.key -out $CERT_DIR/broker.csr -subj "/CN=localhost"
openssl x509 -req -in $CERT_DIR/broker.csr -CA $CERT_DIR/ca.crt -CAkey $CERT_DIR/ca.key -CAcreateserial -out $CERT_DIR/broker.crt -days 365

# 3. Generate Client Certificate (for ESP32 and Python Agent)
openssl genrsa -out $CERT_DIR/client.key 2048
openssl req -new -key $CERT_DIR/client.key -out $CERT_DIR/client.csr -subj "/CN=esp32-motor-01"
openssl x509 -req -in $CERT_DIR/client.csr -CA $CERT_DIR/ca.crt -CAkey $CERT_DIR/ca.key -CAcreateserial -out $CERT_DIR/client.crt -days 365

echo "Certificates generated in $CERT_DIR"
