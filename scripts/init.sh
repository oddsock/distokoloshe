#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"

generate_secret() {
  openssl rand -hex 32
}

if [ -f "$ENV_FILE" ]; then
  echo ".env already exists. Delete it first if you want to regenerate."
  exit 1
fi

LIVEKIT_API_KEY="distokoloshe"
LIVEKIT_API_SECRET="$(generate_secret)"
JWT_SECRET="$(generate_secret)"
E2EE_SECRET="$(generate_secret)"

cat > "$ENV_FILE" <<EOF
# ── Domain (set these for production TLS) ───────────────
DOMAIN=distokoloshe.example.com
ACME_EMAIL=admin@example.com

# ── LiveKit ─────────────────────────────────────────────
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}

# ── App Auth ────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
E2EE_SECRET=${E2EE_SECRET}

# ── Ports (dev defaults, override to avoid conflicts) ───
# WEB_PORT=3080
# WEB_TLS_PORT=3443
# LK_PORT=7881
EOF

echo "Generated .env with fresh secrets."
echo "  LIVEKIT_API_KEY    = ${LIVEKIT_API_KEY}"
echo "  LIVEKIT_API_SECRET = ${LIVEKIT_API_SECRET:0:8}..."
echo "  JWT_SECRET         = ${JWT_SECRET:0:8}..."
echo "  E2EE_SECRET        = ${E2EE_SECRET:0:8}..."
echo ""
echo "Next steps:"
echo "  1. Edit .env and set DOMAIN + ACME_EMAIL for production"
echo "  2. docker compose build"
echo "  3. docker compose up -d"
echo "  4. For TLS: ./scripts/init-certs.sh"
