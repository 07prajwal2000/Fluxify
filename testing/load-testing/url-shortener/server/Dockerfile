# Production image for the hand-coded url-shortener server.
# Build context is the url-shortener folder (the server imports ../id.ts):
#   docker build -f server/Dockerfile -t lt-urlshortener-ts .
FROM oven/bun:1 AS deps
WORKDIR /app/server
COPY server/package.json server/bun.lock* ./
RUN bun install --production --frozen-lockfile

FROM oven/bun:1-slim
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY id.ts /app/id.ts
COPY server/package.json server/index.ts ./
USER bun
EXPOSE 3000
CMD ["bun", "index.ts"]
