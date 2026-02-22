FROM node:20-alpine AS build

# Work from apps/web so ../../packages/ui/src resolves correctly
WORKDIR /app/apps/web

# Install web dependencies
COPY apps/web/package.json apps/web/package-lock.json* ./
RUN npm install

# Symlink node_modules at /app/ so packages/ui imports can resolve deps
RUN ln -s /app/apps/web/node_modules /app/node_modules

# Copy shared UI package source (Vite alias: ../../packages/ui/src → /app/packages/ui/src)
COPY packages/ui/src /app/packages/ui/src

# Copy web app source
COPY apps/web/ ./

# Build
RUN npm run build

FROM nginx:1.27-alpine
# Copy built SPA
COPY --from=build /app/apps/web/dist /app
# Copy both nginx configs as templates
RUN mkdir -p /etc/nginx/templates
COPY apps/web/nginx.conf /etc/nginx/templates/nginx.conf
COPY apps/web/nginx.tls.conf /etc/nginx/templates/nginx.tls.conf
# Entrypoint selects HTTP or HTTPS config based on cert presence
COPY apps/web/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80 443/tcp 443/udp
ENTRYPOINT ["/entrypoint.sh"]
