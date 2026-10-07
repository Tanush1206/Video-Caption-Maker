# syntax=docker/dockerfile:1.7
#
# Targets: `runtime` (a standalone production server, what ships) and `dev`
# (the Next dev server, used by docker-compose.yml with the source mounted).

ARG NODE_IMAGE=node:20.20.2-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS dev
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY . .
# "local" is a single-user install with no login. A hosted build passes
# --build-arg NEXT_PUBLIC_AUTH_MODE=accounts.
ARG NEXT_PUBLIC_AUTH_MODE=local
# Empty: the browser calls /api on this server's own origin, which proxies it.
ENV NEXT_PUBLIC_API_URL="" \
    NEXT_PUBLIC_AUTH_MODE=${NEXT_PUBLIC_AUTH_MODE} \
    BACKEND_URL=http://backend:8000 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM ${NODE_IMAGE} AS runtime
ARG VERSION=dev
LABEL org.opencontainers.image.source="https://github.com/Tanush1206/Video-Caption-Maker" \
      org.opencontainers.image.title="VideoCaptionMaker frontend" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -q --spider http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
