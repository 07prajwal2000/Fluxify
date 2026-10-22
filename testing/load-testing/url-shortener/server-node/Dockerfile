# Production image for the Node.js twin of the url-shortener server.
# Build context is the url-shortener folder (the server imports ../id.ts):
#   docker build -f server-node/Dockerfile -t lt-urlshortener-node .
FROM oven/bun:1 AS deps
WORKDIR /app/server-node
COPY server-node/package.json server-node/bun.lock* ./
RUN bun install --production --frozen-lockfile

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app/server-node
COPY --from=deps /app/server-node/node_modules ./node_modules
COPY id.ts /app/id.ts
COPY server-node/package.json server-node/index.ts ./
USER node
EXPOSE 3000
CMD ["node", "index.ts"]
