#!/bin/sh
set -e

echo "[kit] Starting Fluxify services..."

pids=""
start() { "$@" & pids="$pids $!"; }

# Forward SIGTERM/SIGINT to every child, then wait for them to drain.
# Without this trap the shell (PID 1 under tini) swallows the signal and the
# backgrounded services are orphaned — `docker stop` hangs until SIGKILL.
term() {
	echo "[kit] signal received — stopping services..."
	kill -TERM $pids 2>/dev/null || true
	wait
	exit 0
}
trap term TERM INT

# Admin/control-plane server
start bun --cwd=/app/server standalone.js

# Request worker (serves user API traffic; snappy.node sits beside worker.js)
start bun --cwd=/app/server worker.js

# Next.js frontend
start bun --cwd=/app/web apps/web/server.js

# AI Gateway
start bun --cwd=/app/ai-gateway server.js

# Reverse proxy
start caddy run --config /app/Caddyfile

echo "[kit] All services launched."

# Wait for the background processes (or the trap) to finish.
wait
