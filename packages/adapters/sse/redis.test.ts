import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type Docker from "dockerode";
import { Redis } from "ioredis";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";
import { type Harness, brokerSuite, until } from "./brokerSuite";

/**
 * Redis pub/sub against a real server, standalone and as a Cluster. The cluster
 * is one node that owns every slot: enough for the server to report
 * `cluster_enabled:1` and to run SPUBLISH / SSUBSCRIBE, which is what the
 * broker's detection and its sharded path need.
 */

const IMAGE = "valkey/valkey:8-alpine";

/** How many connections the server counts as subscribed (classic or sharded). */
async function subscribed(control: Redis) {
	const list = (await control.client("LIST")) as string;
	return list.split("\n").filter((line) => /\b(sub|ssub)=[1-9]/.test(line)).length;
}

function ready(control: () => Redis, cluster: boolean) {
	return async () => {
		try {
			if (!cluster) return (await control().ping()) === "PONG";
			return /cluster_state:ok/.test(await control().cluster("INFO"));
		} catch {
			return false;
		}
	};
}

async function start(name: string, cluster: boolean) {
	await docker.getContainer(name).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	// a cluster node announces its own port, so the host port has to be the container's
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name,
			...(cluster
				? {
						Cmd: [
							"valkey-server",
							"--port",
							String(port),
							"--protected-mode",
							"no",
							"--cluster-enabled",
							"yes",
							"--cluster-announce-ip",
							"127.0.0.1",
						],
					}
				: {}),
			ExposedPorts: { [`${cluster ? port : 6379}/tcp`]: {} },
			HostConfig: {
				PortBindings: { [`${cluster ? port : 6379}/tcp`]: [{ HostPort: String(port) }] },
			},
		}),
	);
	return started;
}

function redisSuite(title: string, name: string, cluster: boolean) {
	describe(title, () => {
		let container: Docker.Container | undefined;
		let control: Redis;
		let port: number;

		const config = () => ({ host: "127.0.0.1", port, source: "credentials" as const });
		const harness: Harness = {
			source: () => ({ kind: "redis", config: config() }),
			kv: () => ({ ...config(), variant: "Redis" }),
			subscribers: () => subscribed(control),
			restart: async () => {
				await container!.restart({ t: 1 });
				await until(ready(() => control, cluster), 60_000);
			},
		};

		beforeAll(async () => {
			const started = await start(name, cluster);
			container = started.container;
			port = started.port;
			control = new Redis({ host: "127.0.0.1", port });
			await until(async () => (await control.ping().catch(() => "")) === "PONG", 60_000);
			if (cluster) await control.cluster("ADDSLOTSRANGE", 0, 16383);
			await until(ready(() => control, cluster), 60_000);
		}, 180_000);

		afterAll(async () => {
			control?.disconnect();
			if (container) await container.remove({ force: true }).catch(() => {});
		});

		it(`detects ${cluster ? "a cluster" : "a standalone server"}`, async () => {
			expect(/cluster_enabled:1/.test(await control.info("cluster"))).toBe(cluster);
		});

		brokerSuite(() => harness);
	});
}

redisSuite("SSE broker on Redis (standalone)", "fluxify-sse-redis-test", false);
redisSuite("SSE broker on Redis Cluster (sharded pub/sub)", "fluxify-sse-redis-cluster-test", true);
