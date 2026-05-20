#!/usr/bin/env bash
set -euo pipefail

# Renew Let's Encrypt cert and reload nginx if renewed.
# Run via cron: 0 3 * * * /home/debian/distokoloshe/infra/scripts/renew-cert.sh 2>&1 | logger -t certbot-renew

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
cd "$PROJECT_DIR"

docker exec distokoloshe_certbot certbot renew \
  --quiet \
  --webroot -w /var/www/certbot \
  --deploy-hook "echo RENEWED"

# Reload nginx so it picks up the new cert without dropping connections
docker exec distokoloshe_web nginx -s reload
