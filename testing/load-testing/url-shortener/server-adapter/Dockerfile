# Production image for the adapter-based server. Build the bundle first (it reads the
# monorepo's packages/adapters), then build with the url-shortener folder as context:
#   Routing-trie variant: bun build.ts index-trie.ts dist-trie, then --build-arg BUNDLE=dist-trie/index-trie.js
#   (cd server-adapter && bun build.ts) && docker build -f server-adapter/Dockerfile -t lt-urlshortener-adapter .
FROM oven/bun:1-slim
ENV NODE_ENV=production
WORKDIR /app
ARG BUNDLE=dist/index.js
COPY server-adapter/${BUNDLE} ./index.js
USER bun
EXPOSE 3000
CMD ["bun", "index.js"]
