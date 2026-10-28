# syntax=docker/dockerfile:1.7
#
# Targets: `runtime` (a standalone production server, what ships) and `dev`
# (the Next dev server, used by docker-compose.yml with the source mounted).

ARG NODE_IMAGE=node:20.20.2-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Optional build-time CA, as in backend/Dockerfile: mounted for the step,
# never stored in a layer.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
    && npm ci --no-audit --no-fund

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
# sharp (Next 15's optional image optimiser, with a prebuilt LGPL libvips) is
# removed first: images.unoptimized means nothing calls it, and without it on
# disk the standalone server can't include it nor /licenses list it.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
    && rm -rf node_modules/sharp node_modules/@img \
    && npm run build

# The licence files of every production dependency (their code is in the
# pages' JavaScript), and Node's own licence for the runtime's Node version.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
    && node scripts/collect-licenses.js /licenses/npm \
    && mkdir -p /licenses/node \
    && node -e "fetch('https://raw.githubusercontent.com/nodejs/node/' + process.version + '/LICENSE') \
        .then((r) => { if (!r.ok) throw new Error('Node licence: HTTP ' + r.status); return r.text(); }) \
        .then((text) => require('fs').writeFileSync('/licenses/node/LICENSE', text))"

FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.source="https://github.com/Tanush1206/Video-Caption-Maker" \
      org.opencontainers.image.title="VideoCaptionMaker frontend"
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/forwarded-for.js ./
# Third-party notices (THIRD_PARTY_NOTICES.md): the app's licence and the
# notices come from the repository root, a second build context
# (`--build-context repo=.`); the package licences from the build; Alpine's
# own packages are listed with where their sources are.
COPY --from=build /licenses /licenses
COPY --from=repo LICENSE THIRD_PARTY_NOTICES.md /licenses/
RUN . /etc/os-release \
    && branch="$(echo "$VERSION_ID" | cut -d. -f1,2)" \
    && { echo "Alpine Linux $VERSION_ID packages in this image: package-version, arch, {source package} and (licence)."; \
         echo "Each source package's build recipe: https://gitlab.alpinelinux.org/alpine/aports/-/tree/$branch-stable/main/<source package>"; \
         echo "The upstream sources those recipes name: https://distfiles.alpinelinux.org/distfiles/v$branch/"; \
         echo "If a link stops working, ask for the source in a GitHub issue: https://github.com/Tanush1206/Video-Caption-Maker/issues"; \
         echo; apk list --installed 2>/dev/null | sed 's/ \[installed\]//'; } > /licenses/SOURCES-alpine.txt
USER app
# Last, so a new version number is metadata only and does not invalidate the
# layers above it (see backend/Dockerfile).
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}"
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
    CMD wget -q --spider http://127.0.0.1:3000/healthz || exit 1
# The preload replaces any caller-sent X-Forwarded-For/-Proto with this
# socket's peer before Next proxies /api (see forwarded-for.js).
CMD ["node", "-r", "./forwarded-for.js", "server.js"]
