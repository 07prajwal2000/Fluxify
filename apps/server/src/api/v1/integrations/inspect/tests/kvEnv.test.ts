// kv_get's `env` (#737) against two real Redis-compatible servers: development
// and production each hold their own value for the same key, and the read must
// reach the one it asked for.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import type Docker from "dockerode";

const IMAGE = "valkey/valkey:8-alpine";
const NAMES = { dev: "fluxify-kv-env-dev-test", prod: "fluxify-kv-env-prod-test" };
const P = "019a0000-0000-7000-8000-000000000000";
const I = "019a0000-0000-7000-8000-000000000001";

const containers: Docker.Container[] = [];
const ports = { dev: 0, prod: 0 };
let row: any;

mock.module("../../get-by-id/repository", () => ({ getIntegrationByID: async () => row }));
mock.module("../../test-connection/service", () => ({ decodeAppConfig: async () => new Map() }));

const { getKvValue } = await import("../service");
const { RedisIntegration } = await import("@fluxify/adapters");

const config = (port: number) => ({ source: "credentials", host: "127.0.0.1", port });
const key = `env_${crypto.randomUUID().slice(0, 8)}`;

async function start(env: "dev" | "prod", value: string) {
	await docker.getContainer(NAMES[env]).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((hostPort) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAMES[env],
			HostConfig: { PortBindings: { "6379/tcp": [{ HostPort: String(hostPort) }] } },
		}),
	);
	containers.push(started.container);
	ports[env] = started.port;
	const kv = new RedisIntegration(config(started.port) as any);
	for (let i = 0; ; i++) {
		try {
			await kv.set(key, value);
			break;
		} catch (error) {
			if (i >= 40) throw error;
			await Bun.sleep(250);
		}
	}
	await kv.disconnect();
}

beforeAll(async () => {
	await Promise.all([start("dev", "from-dev"), start("prod", "from-prod")]);
	row = {
		name: "cache",
		group: "kv",
		variant: "Redis",
		config: config(ports.prod),
		devConfig: config(ports.dev),
		syncDev: false,
	};
}, 180_000);

afterAll(async () => {
	await Promise.all(containers.map((c) => c.remove({ force: true }).catch(() => {})));
});

const params = { projectId: P, integrationId: I };

describe("kv read environment", () => {
	it("reads development's server when no env is given", async () => {
		expect(await getKvValue(params, key)).toMatchObject({ found: true, value: "from-dev" });
	});

	it("reads production's server for env production", async () => {
		expect(await getKvValue(params, key, "production")).toMatchObject({ value: "from-prod" });
	});

	it("development with 'Same as production' reaches production's server", async () => {
		row = { ...row, devConfig: null, syncDev: true };
		expect(await getKvValue(params, key, "development")).toMatchObject({ value: "from-prod" });
	});

	it("development with no config of its own fails loud, even though production has one", async () => {
		row = { ...row, devConfig: null, syncDev: false };
		await expect(getKvValue(params, key, "development")).rejects.toThrow("no development value");
		expect(await getKvValue(params, key, "production")).toMatchObject({ value: "from-prod" });
	});
});
