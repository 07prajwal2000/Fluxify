// A schedule must sit in the namespace of each environment its workflow is live
// in, and nowhere else (#777). The decision itself is unit-tested; this proves
// the broker side against a real NATS — the stream either holds the schedule or
// it does not — the way devNamespace.test.ts proves a fire reaches the right
// worker. A mock would only prove which calls were made.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats, scheduleSubjects } from "@fluxify/common/nats";
import type Docker from "dockerode";
import { natsConnection, natsName } from "../../../db/nats";
import type { FluxifyEnv } from "../../../lib/env";
import { ensureSchedulesStream, removeScheduleEverywhere, syncSchedule } from "../reconciler";
import { SCHEDULES_STREAM, scheduleSubject } from "../subjects";

const IMAGE = "nats:2.14";
const NAME = "fluxify-schedule-per-env-test";
const ENVS: FluxifyEnv[] = ["production", "development"];
const PROJECT = "p1";
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
			// JetStream answering, not merely the port accepting
			await ensureSchedulesStream("production");
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

let n = 0;
const nextId = () => `t-${++n}`;
const trigger = (id: string) => ({
	id,
	projectId: PROJECT,
	workflowId: "w1",
	schedule: "@every 1h",
	timezone: "UTC",
});

/** Which environments' streams currently hold this trigger's schedule. */
async function where(triggerId: string) {
	const held: Record<string, boolean> = {};
	for (const env of ENVS) {
		const subject = natsName(scheduleSubject(PROJECT, triggerId), env);
		const live = await scheduleSubjects(natsConnection(), natsName(SCHEDULES_STREAM, env), subject);
		held[env] = live.includes(subject);
	}
	return held;
}

describe("a schedule per environment", () => {
	const created: string[] = [];

	afterAll(async () => {
		for (const id of created) await removeScheduleEverywhere(PROJECT, id).catch(() => {});
	});

	it("places it where the workflow is live, and removes it where it is not", async () => {
		const id = nextId();
		created.push(id);

		// development only: devActive is on, production has no promoted version
		await syncSchedule(trigger(id), { active: false, devActive: true, prodVersionId: null }, true);
		expect(await where(id)).toEqual({ production: false, development: true });

		// both: active and promoted, devActive on
		await syncSchedule(trigger(id), { active: true, devActive: true, prodVersionId: "v1" }, true);
		expect(await where(id)).toEqual({ production: true, development: true });

		// production only: devActive off
		await syncSchedule(trigger(id), { active: true, devActive: false, prodVersionId: "v1" }, true);
		expect(await where(id)).toEqual({ production: true, development: false });

		// active but never promoted: production's schedule goes away, development's stays
		await syncSchedule(trigger(id), { active: true, devActive: true, prodVersionId: null }, true);
		expect(await where(id)).toEqual({ production: false, development: true });

		// the trigger itself switched off: both go away
		await syncSchedule(trigger(id), { active: true, devActive: true, prodVersionId: "v1" }, false);
		expect(await where(id)).toEqual({ production: false, development: false });
	});

	it("leaves one environment's schedule while the other is turned off", async () => {
		const id = nextId();
		created.push(id);

		await syncSchedule(trigger(id), { active: true, devActive: true, prodVersionId: "v1" }, true);
		expect(await where(id)).toEqual({ production: true, development: true });

		await syncSchedule(trigger(id), { active: false, devActive: true, prodVersionId: null }, true);
		expect(await where(id)).toEqual({ production: false, development: true });

		await removeScheduleEverywhere(PROJECT, id);
		expect(await where(id)).toEqual({ production: false, development: false });
	});
});
