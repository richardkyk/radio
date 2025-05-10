#!/bin/bash

# Load env vars
set -a
. .env
set +a

# Replace placeholders in cert.conf.tpl
envsubst < cert.conf.tpl > cert.conf

# Generate cert
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout .cert/key.pem -out .cert/cert.pem \
  -config cert.conf

echo "✅ Self-signed cert generated for IP: $CERT_IP"
