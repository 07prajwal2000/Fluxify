import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openKvBucket } from "@fluxify/common/nats";
import {
	type NodeHeartbeat,
	NODE_LIVENESS_BUCKET,
	NODE_LIVENESS_TTL_MS,
	orchestratorKeys,
	type PluginInstallStatus,
} from "@fluxify/common/orchestrator";
import { initializeNats } from "../../../../db/nats";
import { watchArtifacts } from "../../../../db/natsKv";
import type { FluxifyEnv } from "../../../../lib/env";
import type { PluginArtifact } from "../../../compiler/artifacts";
import { artifactId, projectArtifactFilters } from "../../../compiler/subjects";
import { createPluginInstaller, type PluginChange } from "../installer";

/**
 * What `compiledWorker.ts` does with plugins, minus the execution process: watch
 * the environment's bucket for the project, install, and report on the node's
 * heartbeat the way a real node does, so the admin side reads it from the broker.
 */
export async function startWorker(
	project: string,
	env: FluxifyEnv,
	onRefsChanged: (change: PluginChange) => Promise<void> = async () => {},
) {
	const root = mkdtempSync(join(tmpdir(), "fx-plugin-worker-"));
	const nodeId = `node-${env}-${crypto.randomUUID().slice(0, 8)}`;
	let statuses: Record<string, PluginInstallStatus> = {};
	const liveness = await openKvBucket<NodeHeartbeat>(await initializeNats(), NODE_LIVENESS_BUCKET, {
		ttlMs: NODE_LIVENESS_TTL_MS,
	});
	const beat = () =>
		liveness
			.put(orchestratorKeys.node(nodeId), {
				nodeId,
				projectId: project,
				type: "both",
				groupIds: [],
				ready: true,
				at: new Date().toISOString(),
				plugins: statuses,
				env,
			})
			.catch(() => {});

	const installer = createPluginInstaller({
		root,
		onStatus: (next) => {
			statuses = next;
			void beat();
		},
		onRefsChanged,
	});
	const watch = await watchArtifacts<PluginArtifact>(
		projectArtifactFilters(project, ["plugin"]),
		(key, value) => installer.apply(project, artifactId(key), value),
		{ includeExisting: true, env },
	);
	await watch.initialized;
	void beat();
	const timer = setInterval(beat, 2_000);

	return {
		nodeId,
		root,
		installer,
		status: () => statuses,
		async stop() {
			clearInterval(timer);
			await watch.stop();
			await liveness.delete(orchestratorKeys.node(nodeId)).catch(() => {});
			rmSync(root, { recursive: true, force: true });
		},
	};
}

/** polls until `done` is true; the last value is returned so a failure shows it */
export async function until<T>(read: () => T, done: (value: T) => boolean, ms = 90_000) {
	const end = Date.now() + ms;
	for (;;) {
		const value = read();
		if (done(value) || Date.now() > end) return value;
		await Bun.sleep(100);
	}
}
