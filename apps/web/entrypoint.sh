#!/bin/sh
set -e

DOMAIN="${DOMAIN:-localhost}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"

if [ -f "$CERT" ]; then
  echo "TLS certs found for ${DOMAIN} — enabling HTTPS + HSTS + HTTP/3"
  envsubst '${DOMAIN}' < /etc/nginx/templates/nginx.tls.conf > /etc/nginx/conf.d/default.conf

  # Watch for cert renewal and reload nginx when it changes
  (
    LAST=$(md5sum "$CERT" | cut -d' ' -f1)
    while sleep 1h; do
      CURRENT=$(md5sum "$CERT" | cut -d' ' -f1)
      if [ "$CURRENT" != "$LAST" ]; then
        echo "Cert renewed — reloading nginx"
        nginx -s reload
        LAST="$CURRENT"
      fi
    done
  ) &
else
  echo "No TLS certs found — running in HTTP-only dev mode"
  cp /etc/nginx/templates/nginx.conf /etc/nginx/conf.d/default.conf
fi

exec nginx -g 'daemon off;'
