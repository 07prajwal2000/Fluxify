#!/bin/sh
set -e

echo "[admin] Starting Fluxify control plane..."

pids=""
start() { "$@" & pids="$pids $!"; }

wait_until() {
	_label="$1"
	shift
	_attempt=0
	while [ "$_attempt" -lt 60 ]; do
		if "$@" >/dev/null 2>&1; then return 0; fi
		_attempt=$((_attempt + 1))
		sleep 1
	done
	echo "[admin] $_label did not become ready" >&2
	exit 1
}

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

# The admin server owns migrations. Do not let the telemetry worker query a
# freshly created database before those tables exist.
wait_until "admin server" wget -qO- http://127.0.0.1:5500/_/admin/api/public-settings

# Route telemetry consumer. It shares the control plane's database and NATS
# access, while compiled request workers only publish completed runs over IPC.
start bun --cwd=/app/server telemetryWorker.js

# Next.js admin UI
start bun --cwd=/app/web apps/web/server.js

# AI Gateway
start bun --cwd=/app/ai-gateway server.js

# Reverse proxy (user API is proxied to the external worker via WORKER_UPSTREAM)
start caddy run --config /app/Caddyfile

echo "[admin] Control plane launched."

# Wait for the background processes (or the trap) to finish.
wait
