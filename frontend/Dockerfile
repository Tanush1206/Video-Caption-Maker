FROM node:20-alpine

# Optional extra CA certificates, for machines where antivirus or a corporate
# proxy inspects TLS. Without this, next/font's Google Fonts download fails and
# silently falls back. The bracket glob is a no-op when frontend/certs/ is
# absent, which is the normal case — the directory is gitignored.
COPY cert[s]/ /usr/local/share/extra-certs/
RUN mkdir -p /usr/local/share/extra-certs \
    && cat /usr/local/share/extra-certs/*.crt > /usr/local/share/extra-ca.pem 2>/dev/null || : \
    && touch /usr/local/share/extra-ca.pem

# Node keeps its own bundled CA list and ignores the system store.
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/extra-ca.pem

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
