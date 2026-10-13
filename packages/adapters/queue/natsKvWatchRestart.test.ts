// A KV watch must keep delivering after NATS is recreated on a persisted volume
// (#789). nats.js rebuilds the watch on reconnect itself, but when JetStream is
// not ready yet that rebuild fails silently and the iterator hangs; startWatch
// re-opens it on reconnect. A mock cannot show this, only a real server can.
//
// Opt-in because it recreates a server and waits on reconnects (~30s):
// `FLUXIFY_NATS_RESTART_TEST=1 bun test packages/adapters/queue/natsKvWatchRestart.test.ts`
import { afterAll, describe, expect, it } from "bun:test";
import { openKvBucket } from "@fluxify/common/nats";
import { connect } from "@nats-io/transport-node";
import type Docker from "dockerode";
import { docker, pullImage, startContainerWithRandomPort } from "../containerTestHelpers";

const IMAGE = "nats:2.14-alpine";
const NAME = "fluxify-nats-kv-restart-test";
const VOLUME = `${NAME}-data`;
const enabled = process.env.FLUXIFY_NATS_RESTART_TEST === "1";
let container: Docker.Container | undefined;

const create = (port: number, persisted: boolean) =>
	docker.createContainer({
		Image: IMAGE,
		name: NAME,
		Cmd: persisted ? ["-js", "-sd", "/data"] : ["-js"],
		HostConfig: {
			PortBindings: { "4222/tcp": [{ HostPort: String(port) }] },
			...(persisted ? { Binds: [`${VOLUME}:/data`] } : {}),
		},
		ExposedPorts: { "4222/tcp": {} },
	});

afterAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await docker.getVolume(VOLUME).remove().catch(() => {});
});

describe.skipIf(!enabled).each([
	["a persisted volume (data survives)", true],
	["no storage (the stream is gone)", false],
])("kv watch after NATS is recreated with %s", (_label, persisted) => {
	it("keeps delivering updates once JetStream is back", async () => {
		await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
		await docker.getVolume(VOLUME).remove().catch(() => {});
		await pullImage(IMAGE);
		const started = await startContainerWithRandomPort((port) => create(port, persisted));
		container = started.container;
		const servers = `127.0.0.1:${started.port}`;

		let nc: Awaited<ReturnType<typeof connect>> | undefined;
		for (let i = 0; !nc; i++) {
			nc = await connect({ servers, maxReconnectAttempts: -1 }).catch(async (e) => {
				if (i > 60) throw e;
				await Bun.sleep(500);
				return undefined;
			});
		}
		try {
			const bucket = await openKvBucket<string>(nc, "restart_test", { history: 5 });
			await bucket.put("k", "before");
			const seen: Array<[string, string | null]> = [];
			const fatal: unknown[] = [];
			const watcher = await bucket.watch("k", (key, value) => void seen.push([key, value]), {
				onFatal: (e) => fatal.push(e),
			});
			await watcher.initialized;
			expect(seen).toEqual([["k", "before"]]);

			// recreate: the data survives on the volume, the watch consumer does not
			await container.remove({ force: true });
			container = (await startContainerWithRandomPort(() => create(started.port, persisted))).container;

			// wait for JetStream to answer (recreating the bucket when the data is gone,
			// as the next process to start would), then write
			let written = false;
			for (let i = 0; i < 120 && !written; i++) {
				written = await openKvBucket<string>(nc, "restart_test", { history: 5 })
					.then((b) => b.put("k", "after"))
					.then(
					() => true,
					() => false,
				);
				if (!written) await Bun.sleep(500);
			}
			expect(written).toBe(true);

			for (let i = 0; i < 100 && !seen.some(([, v]) => v === "after"); i++) await Bun.sleep(100);
			expect(seen.at(-1)).toEqual(["k", "after"]);
			expect(fatal).toHaveLength(0);
			await watcher.stop();
		} finally {
			await nc.close();
		}
	}, 120_000);
});
