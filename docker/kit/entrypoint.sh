#!/bin/sh
set -e

echo "[kit] Starting Fluxify services..."

# Start backend server
bun --cwd=/app/server standalone.js &

# Start Next.js frontend
bun --cwd=/app/web apps/web/server.js &

# Start AI Gateway
bun --cwd=/app/ai-gateway index.js &

# Start reverse proxy
caddy run --config /app/Caddyfile &

echo "[kit] All services launched."

# Wait for any background process to exit
wait
