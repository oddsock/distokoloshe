FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# Copy built SPA
COPY --from=build /app/dist /app
# Copy both nginx configs as templates
RUN mkdir -p /etc/nginx/templates
COPY nginx.conf /etc/nginx/templates/nginx.conf
COPY nginx.tls.conf /etc/nginx/templates/nginx.tls.conf
# Entrypoint selects HTTP or HTTPS config based on cert presence
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 80 443/tcp 443/udp
ENTRYPOINT ["/entrypoint.sh"]
