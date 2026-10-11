// `active` is production and `devActive` is development (#738), on a real NATS:
// the artifact goes to a bucket only where the route is switched on, and turning
// one off removes that environment's artifact. A mock would only prove the
// calls; the bucket proves what a worker would find.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats } from "@fluxify/common/nats";
import type Docker from "dockerode";

const { getArtifact } = await import("../../../db/natsKv");
const { compilePerEnv, putPerEnv } = await import("../observability");

const IMAGE = "nats:2.14";
const NAME = "fluxify-per-env-switches-test";
let container: Docker.Container;

beforeAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((port) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAME,
			Cmd: ["-js"],
			HostConfig: { PortBindings: { "4222/tcp": [{ HostPort: String(port) }] } },
			ExposedPorts: { "4222/tcp": {} },
		}),
	);
	container = started.container;
	for (let i = 0; ; i++) {
		try {
			await connectNats({ servers: `nats://127.0.0.1:${started.port}` });
			await getArtifact("probe", "production");
			break;
		} catch (error) {
			await closeNats().catch(() => {});
			if (i >= 60) throw error;
			await Bun.sleep(500);
		}
	}
}, 120_000);

afterAll(async () => {
	await closeNats().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

const observability = {
	tracingEnabled: false,
	recordExecution: false,
	devTracingEnabled: false,
	devRecordExecution: true,
};
const perEnv = compilePerEnv(observability, () => "compiled source");
let n = 0;
const key = () => `routes/p/r${++n}-${crypto.randomUUID().slice(0, 6)}`;
const artifact = { routeId: "r", path: "/x" };
const where = async (k: string) => ({
	production: (await getArtifact(k, "production")) !== null,
	development: (await getArtifact(k, "development")) !== null,
});

describe("putPerEnv", () => {
	it("publishes to development only when only devActive is on", async () => {
		const k = key();
		await putPerEnv(k, artifact, perEnv, { active: false, devActive: true });
		expect(await where(k)).toEqual({ production: false, development: true });
	});

	it("publishes to production only when only active is on", async () => {
		const k = key();
		await putPerEnv(k, artifact, perEnv, { active: true, devActive: false });
		expect(await where(k)).toEqual({ production: true, development: false });
	});

	it("publishes each environment its own switches and the same source", async () => {
		const k = key();
		await putPerEnv(k, artifact, perEnv, { active: true, devActive: true });
		expect(await getArtifact(k, "development")).toMatchObject({
			recordExecution: true,
			source: "compiled source",
		});
		expect(await getArtifact(k, "production")).toMatchObject({
			recordExecution: false,
			source: "compiled source",
		});
	});

	it("removes an environment's artifact when its switch goes off, and keeps the other", async () => {
		const k = key();
		await putPerEnv(k, artifact, perEnv, { active: true, devActive: true });
		await putPerEnv(k, artifact, perEnv, { active: true, devActive: false });
		expect(await where(k)).toEqual({ production: true, development: false });
		await putPerEnv(k, artifact, perEnv, { active: false, devActive: true });
		expect(await where(k)).toEqual({ production: false, development: true });
	});

	it("treats a null active (a row from before the column had a default) as off", async () => {
		const k = key();
		await putPerEnv(k, artifact, perEnv, { active: null, devActive: true });
		expect(await where(k)).toEqual({ production: false, development: true });
	});
});
