#!/bin/sh
set -e

DOMAIN="${DOMAIN:-localhost}"

if [ -z "${LIVEKIT_API_KEY:-}" ]; then
  echo "FATAL: LIVEKIT_API_KEY not set (needed to sign webhooks to the API)"
  exit 1
fi

# Substitute ${DOMAIN} and ${LIVEKIT_API_KEY} in config template
sed -e "s/\${DOMAIN}/${DOMAIN}/g" -e "s/\${LIVEKIT_API_KEY}/${LIVEKIT_API_KEY}/g" \
  /etc/livekit.yaml.tmpl > /etc/livekit.yaml

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  # Production mode: use external IP discovery for correct public ICE candidates
  echo "TLS certs found for ${DOMAIN} — production mode (TURN + external IP)"
  sed -i '/^rtc:/a\  use_external_ip: true' /etc/livekit.yaml
else
  # Dev mode: use local interfaces so ICE works on same machine (no hairpin NAT needed)
  echo "No TLS certs for ${DOMAIN} — dev mode (no TURN, local IPs)"
  sed -i '/^turn:/,/^[^ ]/{ /^turn:/d; /^  /d; }' /etc/livekit.yaml
  sed -i '/^rtc:/a\  use_external_ip: false' /etc/livekit.yaml
fi

echo "--- LiveKit config ---"
cat /etc/livekit.yaml
echo "----------------------"

exec /livekit-server --config /etc/livekit.yaml "$@"
