// System ticks (#619) against a real NATS 2.14, which is what owns schedules.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import {
	closeNats,
	connectNats,
	consumeQueue,
	ensureConsumer,
	natsConnection,
	publishToStream,
	type QueueConsumer,
	scheduleSubjects,
} from "@fluxify/common/nats";
import type Docker from "dockerode";
import { ensureSchedulesStream, reconcileSchedules } from "../reconciler";
import {
	ALL_PROJECTS,
	fireConsumerName,
	projectFireFilter,
	SCHEDULES_STREAM,
	systemFireSubject,
} from "../subjects";
import { onSystemTick, publishSystemTicks } from "../system";

const IMAGE = "nats:2.14";
const NAME = "fluxify-system-ticks-test";
let container: Docker.Container;
const consumers: QueueConsumer[] = [];

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
			await ensureSchedulesStream();
			break;
		} catch (error) {
			await closeNats();
			if (i >= 60) throw error;
			await Bun.sleep(500);
		}
	}
}, 120_000);

afterAll(async () => {
	await Promise.allSettled(consumers.map((c) => c.stop()));
	await closeNats().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

async function until(done: () => boolean, ms = 10_000) {
	const deadline = Date.now() + ms;
	while (!done()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await Bun.sleep(50);
	}
}

/** A fake tick: exactly what the broker copies onto the fire subject. */
const tick = (name: string) =>
	publishToStream(natsConnection(), systemFireSubject(name), { tick: name });

describe("system ticks", () => {
	it("publishes both schedules and survives the reconciler's boot sweep", async () => {
		await publishSystemTicks();
		// A restart: no triggers in the database, then the ticks again.
		await reconcileSchedules([]);
		await publishSystemTicks();
		const live = await scheduleSubjects(
			natsConnection(),
			SCHEDULES_STREAM,
			"fluxify.schedules.sys.*",
		);
		expect(live.sort()).toEqual(["fluxify.schedules.sys.daily", "fluxify.schedules.sys.hourly"]);
	});

	it("runs a job once per tick across replicas, and the workers never see it", async () => {
		// The catch-all worker's fire consumer, as a compiled worker sets it up.
		const workerDurable = fireConsumerName(ALL_PROJECTS);
		await ensureConsumer(natsConnection(), SCHEDULES_STREAM, {
			durable: workerDurable,
			filterSubjects: [projectFireFilter(ALL_PROJECTS)],
		});
		let workerSaw = 0;
		consumers.push(
			await consumeQueue(natsConnection(), SCHEDULES_STREAM, workerDurable, async () => {
				workerSaw++;
			}),
		);

		let daily = 0;
		let hourly = 0;
		// Two admin replicas registering the same job share one durable.
		for (let i = 0; i < 2; i++) {
			consumers.push(await onSystemTick("daily", "test-retention", async () => void daily++));
		}
		consumers.push(await onSystemTick("hourly", "test-hourly", async () => void hourly++));

		await tick("daily");
		await until(() => daily === 1);
		await Bun.sleep(500);
		expect(daily).toBe(1);
		expect(hourly).toBe(0);

		expect(workerSaw).toBe(0);
	});
});
