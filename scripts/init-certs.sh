#!/usr/bin/env bash
set -euo pipefail

# Generate initial Let's Encrypt certificates.
# Run ONCE before first production deployment.
#
# Prerequisites:
#   - DNS A record pointing DOMAIN to this server's public IP
#   - Port 80 reachable from the internet
#   - .env file with DOMAIN and ACME_EMAIL set

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Load .env
if [ ! -f ".env" ]; then
  echo "Error: .env not found. Run ./scripts/init.sh first."
  exit 1
fi
set -a; source ".env"; set +a

if [ -z "${DOMAIN:-}" ] || [ "$DOMAIN" = "distokoloshe.example.com" ]; then
  echo "Error: Set DOMAIN in .env to your actual domain."
  exit 1
fi

if [ -z "${ACME_EMAIL:-}" ] || [ "$ACME_EMAIL" = "admin@example.com" ]; then
  echo "Error: Set ACME_EMAIL in .env to your email address."
  exit 1
fi

echo "Requesting Let's Encrypt certificate for: ${DOMAIN}"
echo "ACME email: ${ACME_EMAIL}"
echo ""

# Ensure webroot directory exists
mkdir -p "./data/certbot/www"

# Create the named volume if it doesn't exist
docker volume create distokoloshe_certs 2>/dev/null || true

# Start nginx in HTTP-only mode for ACME challenge
echo "Starting nginx for ACME challenge..."
docker compose up -d --build web

sleep 3

# Request certificate via certbot container
echo "Requesting certificate..."
docker compose run --rm \
  --no-deps \
  certbot certonly \
    --webroot \
    -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$ACME_EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive

echo ""
echo "Certificate obtained! Restarting all services with TLS..."
docker compose down
docker compose --profile production up -d

echo ""
echo "Done! Your site is available at: https://${DOMAIN}"
echo "Certbot will auto-renew certificates every 12 hours."
