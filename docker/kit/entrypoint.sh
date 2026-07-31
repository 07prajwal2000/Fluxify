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

# Admin/control-plane server. Runs migrations and hosts the compiler, which
# turns saved routes into JavaScript and publishes them to the NATS KV bucket.
start bun --cwd=/app/server standalone.js

# Compiled request worker — serves user API traffic from those artifacts.
#
# It serves exactly one project, so it cannot start before a project exists.
# On a first boot that is the normal state: bring the kit up without it, create
# a project in the UI, then set WORKER_PROJECT_ID and restart.
if [ -n "$WORKER_PROJECT_ID" ]; then
	start bun --cwd=/app/server compiledWorker.js
else
	echo "[kit] WORKER_PROJECT_ID is not set — starting without the request worker."
	echo "[kit] Create a project at /_/admin/ui, then set WORKER_PROJECT_ID and restart."
fi

# Next.js admin UI
start bun --cwd=/app/web apps/web/server.js

# AI Gateway
start bun --cwd=/app/ai-gateway server.js

# Reverse proxy — the single published port
start caddy run --config /app/Caddyfile

echo "[kit] All services launched."

# Wait for the background processes (or the trap) to finish.
wait
