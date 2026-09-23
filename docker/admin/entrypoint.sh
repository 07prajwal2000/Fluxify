#!/bin/sh
set -e

echo "[admin] Starting Fluxify control plane..."

pids=""
start() { "$@" & pids="$pids $!"; }

wait_until() {
	_label="$1"
	shift
	_attempt=0
	while [ "$_attempt" -lt 180 ]; do
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
admin_pid=$!

# The admin server owns migrations. The AI gateway has no schema-wait of its
# own and dies outright on a missing app_config.
# Up to 180s: the server itself waits up to a minute each for Postgres and NATS
# (#463). If it gives up first it exits, having logged what it could not reach,
# and so does this script.
admin_up() {
	kill -0 "$admin_pid" || exit 1
	wget -qO- http://127.0.0.1:5500/_/admin/api/public-settings
}
wait_until "admin server" admin_up

# The admin UI is a static Vite bundle in /app/portal, served by Caddy.

# AI Gateway
start bun --cwd=/app/ai-gateway server.js

# Reverse proxy (user API is proxied to the external worker via WORKER_UPSTREAM)
start caddy run --config /app/Caddyfile

echo "[admin] Control plane launched."

# Wait for the background processes (or the trap) to finish.
wait
