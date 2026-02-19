#!/usr/bin/env bash
set -euo pipefail

# Generate initial Let's Encrypt certificates.
# Run ONCE before first production deployment.
#
# Prerequisites:
#   - DNS A record pointing DOMAIN to this server's public IP
#   - Port 80 reachable from the internet (not blocked by firewall)
#   - .env file with DOMAIN and ACME_EMAIL set
#
# This script will:
#   1. Start nginx on port 80 for the ACME HTTP-01 challenge
#   2. Request a certificate from Let's Encrypt
#   3. Restart all services with TLS on ports 80 (redirect) + 443

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

# Check port 80 is not already in use
if ss -tlnp 2>/dev/null | grep -q ':80 '; then
  echo "Warning: Port 80 is already in use."
  echo "  Stop the existing service or free port 80 before continuing."
  echo ""
  ss -tlnp 2>/dev/null | grep ':80 ' || true
  echo ""
  read -rp "Try anyway? [y/N] " answer
  if [[ ! "$answer" =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "Requesting Let's Encrypt certificate for: ${DOMAIN}"
echo "ACME email: ${ACME_EMAIL}"
echo ""

# Ensure webroot directory exists
mkdir -p "./data/certbot/www"

# Stop any running containers to free ports
echo "Stopping existing containers..."
docker compose --profile production down 2>/dev/null || true

# Start nginx on port 80 for ACME challenge
# Override WEB_PORT to 80 regardless of .env setting
echo "Starting nginx on port 80 for ACME challenge..."
WEB_PORT=80 WEB_TLS_PORT=443 docker compose up -d --build web

# Wait for nginx to be ready
echo "Waiting for nginx to start..."
for i in $(seq 1 15); do
  if curl -sf -o /dev/null http://127.0.0.1/; then
    echo "  nginx is responding."
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "Error: nginx did not start in time. Check logs:"
    docker compose logs web --tail=20
    exit 1
  fi
  sleep 1
done

# Request certificate via certbot container
echo ""
echo "Requesting certificate from Let's Encrypt..."
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

# Update .env to use production ports if still on dev defaults
if ! grep -q "^WEB_PORT=" ".env"; then
  echo "" >> ".env"
  echo "# ── Production ports ─────────────────────────────────" >> ".env"
  echo "WEB_PORT=80" >> ".env"
  echo "WEB_TLS_PORT=443" >> ".env"
  echo "  Added WEB_PORT=80 and WEB_TLS_PORT=443 to .env"
fi

# Start all services including certbot renewal
docker compose --profile production up -d

echo ""
echo "Done! Your site is available at: https://${DOMAIN}"
echo "  - HTTP  (port 80)  → redirects to HTTPS"
echo "  - HTTPS (port 443) → serves the app"
echo "  - Certbot renews certificates automatically every 12 hours"
