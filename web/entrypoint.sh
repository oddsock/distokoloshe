#!/bin/sh
set -e

DOMAIN="${DOMAIN:-localhost}"

if [ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]; then
  echo "TLS certs found for ${DOMAIN} — enabling HTTPS + HSTS + HTTP/3"
  envsubst '${DOMAIN}' < /etc/nginx/templates/nginx.tls.conf > /etc/nginx/conf.d/default.conf
else
  echo "No TLS certs found — running in HTTP-only dev mode"
  cp /etc/nginx/templates/nginx.conf /etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
