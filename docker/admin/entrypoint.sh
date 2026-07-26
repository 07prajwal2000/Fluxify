#!/bin/sh
set -e

echo "[admin] Starting Fluxify control plane..."

pids=""
start() { "$@" & pids="$pids $!"; }

# This shell is PID 1 (no tini), so it must both install a signal handler AND
# forward it to the children — otherwise SIGTERM is dropped and `docker stop`
# hangs until SIGKILL, leaving the services orphaned.
term() {
	echo "[admin] signal received — stopping services..."
	kill -TERM $pids 2>/dev/null || true
	wait
	exit 0
}
trap term TERM INT

# Admin API server (control plane; no builtin worker)
start bun --cwd=/app/server standalone.js

# Next.js admin UI
start bun --cwd=/app/web apps/web/server.js

# AI Gateway
start bun --cwd=/app/ai-gateway server.js

# Reverse proxy (user API is proxied to the external worker via WORKER_UPSTREAM)
start caddy run --config /app/Caddyfile

echo "[admin] Control plane launched."

# Wait for the background processes (or the trap) to finish.
wait
