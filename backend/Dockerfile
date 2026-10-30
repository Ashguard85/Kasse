# KinderKasse Backend: Debian/Node 20 fuer die vorhandenen nativen
# better-sqlite3- und sharp-Abhaengigkeiten beibehalten.
FROM node:20-bookworm-slim

# Falls kein passendes vorgebautes Binary verfuegbar ist, kompiliert
# better-sqlite3 via node-gyp. node:*-slim enthaelt diese Tools nicht.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./

# Ausfuehrliche Installationslogs direkt in Portainer anzeigen.
# package-lock.json bleibt fuer reproduzierbare Builds massgebend.
RUN npm ci --omit=dev --no-audit --no-fund --foreground-scripts

COPY . .
RUN mkdir -p /app/data /app/data/uploads
EXPOSE 3801
CMD ["node", "server.js"]
