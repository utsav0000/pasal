# ---- build ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/pasal.db UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY package.json package-lock.json* ./
RUN (npm ci --omit=dev || npm install --omit=dev) && npm cache clean --force
COPY --from=build /app/public ./public
COPY server ./server
COPY config ./config
COPY scripts/seed.mjs scripts/
RUN mkdir -p /data/uploads && chown -R node:node /data /app/public
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
