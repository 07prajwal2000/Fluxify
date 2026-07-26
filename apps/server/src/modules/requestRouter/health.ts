import { Hono } from "hono";
import { natsConnected } from "../../db/nats";

// Flipped true once initWorker() has finished loading every dependency
// (app config, integrations, project settings, custom blocks + their hot-reload
// subscriptions, and routes). Until then the worker is up but not serving.
let depsReady = false;

export function markReady() {
	depsReady = true;
}

/**
 * k8s-style probes. Register BEFORE mapRouter so its `all("*")` catch-all
 * doesn't swallow these paths.
 *   - startup: 200 as soon as the process is listening (liveness of the boot).
 *   - ready:   200 only when every dependency is loaded AND pubsub is connected;
 *              503 otherwise so traffic isn't routed to a half-loaded worker.
 */
export function registerHealthRoutes(app: Hono<any>) {
	app.get("/_/admin/api/healthchecks/startup", (c) => c.body(null, 200));

	app.get("/_/admin/api/healthchecks/ready", (c) => {
		const ready = depsReady && natsConnected();
		return c.body(null, ready ? 200 : 503);
	});
}
