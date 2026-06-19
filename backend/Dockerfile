# bookworm-slim statt alpine: better-sqlite3 ist ein natives Modul.
# Auf Alpine (musl) gibt es oft keine passenden Prebuilds, dann muss von Source
# kompiliert werden, was zusätzliche Build-Tools braucht. bookworm-slim (glibc)
# hat zuverlässigere Prebuild-Unterstützung und ist insgesamt weniger Ärger.
# Gleicher Vorteil gilt für "sharp" (HEIC/Bildverarbeitung): auf glibc-Systemen
# lädt npm install automatisch ein vorgebautes libvips-Binary herunter, ohne
# dass zusätzliche System-Pakete installiert werden müssen.
FROM node:20-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/data /app/data/uploads
EXPOSE 3801
CMD ["node", "server.js"]
