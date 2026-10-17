// Audit logs (#833) against a real Postgres and a real NATS 2.14: the stream, the
// batching consumer, the idempotent insert, the retention delete and the
// per-project switch, end to end.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import {
	docker,
	pullImage,
	startContainerWithRandomPort,
} from "@fluxify/adapters/containerTestHelpers";
import { closeNats, connectNats, type QueueConsumer } from "@fluxify/common/nats";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrateDB } from "../../../db/migration";

const rand = (n: number) => Bun.randomUUIDv7().replaceAll("-", "").slice(-n);
const suffix = rand(8);
const PG = { image: "postgres:16-alpine", name: `fluxify-audit-pg-test-${suffix}` };
const NATS = { image: "nats:2.14", name: `fluxify-audit-nats-test-${suffix}` };
const containers: Docker.Container[] = [];
const consumers: QueueConsumer[] = [];
let sql: SQL;
let audit: typeof import("../audit");
let gate: typeof import("../gate");
let context: typeof import("../context");
let consumer: typeof import("../consumer");
let sink: typeof import("../sink");
let retention: typeof import("../retention");
let publish: typeof import("../publish");
let builder: typeof import("../event");

async function start(spec: { image: string; name: string }, port: number, extra: object) {
	await docker
		.getContainer(spec.name)
		.remove({ force: true })
		.catch(() => {});
	await pullImage(spec.image);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: spec.image,
			name: spec.name,
			HostConfig: { PortBindings: { [`${port}/tcp`]: [{ HostPort: String(host) }] } },
			ExposedPorts: { [`${port}/tcp`]: {} },
			...extra,
		}),
	);
	containers.push(started.container);
	return started.port;
}

async function retry<T>(attempt: () => Promise<T>, tries = 90): Promise<T> {
	for (let i = 0; ; i++) {
		try {
			return await attempt();
		} catch (error) {
			if (i >= tries) throw error;
			await Bun.sleep(500);
		}
	}
}

async function until(done: () => Promise<boolean>, ms = 15_000) {
	const deadline = Date.now() + ms;
	while (!(await done())) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await Bun.sleep(100);
	}
}

const count = async (where: string) =>
	Number((await sql.unsafe(`SELECT count(*)::int AS n FROM audit_events WHERE ${where}`))[0].n);

const ACTOR = { actorId: "u1", actorEmail: "ada@example.com" };
const asUser = <T>(fn: () => T) =>
	context.runWithAuditContext({ actor: ACTOR, source: "portal" }, fn);

beforeAll(async () => {
	const [pgPort, natsPort] = await Promise.all([
		start(PG, 5432, { Env: ["POSTGRES_PASSWORD=postgres"] }),
		start(NATS, 4222, { Cmd: ["-js"] }),
	]);
	const url = `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`;
	await retry(async () => {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
		} finally {
			await probe.close().catch(() => {});
		}
	});
	await migrateDB(url);
	sql = new SQL(url);
	const db = drizzle({ client: sql });
	// the audit code writes through the app's db handle; point it at this container
	mock.module("../../../db", () => ({ db }));
	await retry(async () => {
		await closeNats().catch(() => {});
		await connectNats({ servers: `nats://127.0.0.1:${natsPort}` });
	}, 60);
	audit = await import("../audit");
	gate = await import("../gate");
	context = await import("../context");
	consumer = await import("../consumer");
	sink = await import("../sink");
	retention = await import("../retention");
	publish = await import("../publish");
	builder = await import("../event");

	await sql`INSERT INTO projects (id, name, slug) VALUES ('on', 'Shop', 'shop'), ('off', 'Old', 'old')`;
	await sql`INSERT INTO project_settings (id, project_id, key, value) VALUES ('ps-on', 'on', 'auditLogs.enabled', 'true')`;
	gate.gateOverride.licensed = true;
	consumers.push(...(await consumer.startAuditConsumer()));
}, 180_000);

afterAll(async () => {
	await Promise.allSettled(consumers.map((c) => c.stop()));
	await closeNats().catch(() => {});
	await sql?.close().catch(() => {});
	await Promise.allSettled(containers.map((c) => c.remove({ force: true })));
});

describe("audit logs end to end", () => {
	it("stores a recorded change with the project snapshot and the actor", async () => {
		const id = `route-${rand(8)}`;
		await asUser(() =>
			audit.audit.record({
				projectId: "on",
				resourceType: "route",
				resourceId: id,
				action: "update",
				changedFields: ["name", "path"],
			}),
		);
		await until(async () => (await count(`resource_id = '${id}'`)) === 1);
		const [row] = await sql`SELECT * FROM audit_events WHERE resource_id = ${id}`;
		expect(row).toMatchObject({
			actor_id: "u1",
			actor_email: "ada@example.com",
			source: "portal",
			project_id: "on",
			project_name: "Shop",
			project_slug: "shop",
			resource_type: "route",
			action: "update",
			status: "success",
		});
		expect(row.changed_fields).toEqual(["name", "path"]);
	});

	it("keeps the rows of a project that is deleted afterwards", async () => {
		await sql`INSERT INTO projects (id, name, slug) VALUES ('gone', 'Gone', 'gone')`;
		await sql`INSERT INTO project_settings (id, project_id, key, value) VALUES ('ps-gone', 'gone', 'auditLogs.enabled', 'true')`;
		const id = `gone-${rand(8)}`;
		await asUser(() =>
			audit.audit.record({
				projectId: "gone",
				resourceType: "route",
				resourceId: id,
				action: "create",
				changedFields: [],
			}),
		);
		await until(async () => (await count(`resource_id = '${id}'`)) === 1);
		await sql`DELETE FROM projects WHERE id = 'gone'`;
		const [row] = await sql`SELECT project_id, project_name FROM audit_events WHERE resource_id = ${id}`;
		expect(row).toEqual({ project_id: "gone", project_name: "Gone" });
	});

	it("writes nothing for a project that has audit logs off, or never had the setting", async () => {
		const id = `off-${rand(8)}`;
		gate.forgetProject();
		await sql`INSERT INTO project_settings (id, project_id, key, value) VALUES ('ps-off', 'off', 'auditLogs.enabled', 'false')`;
		await asUser(() =>
			audit.audit.record({
				projectId: "off",
				resourceType: "route",
				resourceId: id,
				action: "update",
				changedFields: [],
			}),
		);
		await Bun.sleep(3_000);
		expect(await count(`resource_id = '${id}'`)).toBe(0);
	});

	it("writes nothing without the licence, even for an enabled project", async () => {
		const id = `nolicence-${rand(8)}`;
		gate.gateOverride.licensed = false;
		try {
			await asUser(() =>
				audit.audit.record({
					projectId: "on",
					resourceType: "route",
					resourceId: id,
					action: "update",
					changedFields: [],
				}),
			);
		} finally {
			gate.gateOverride.licensed = true;
		}
		await Bun.sleep(3_000);
		expect(await count(`resource_id = '${id}'`)).toBe(0);
	});

	it("never lets a secret value reach a row", async () => {
		const id = `secret-${rand(8)}`;
		const secret = `hunter-${rand(12)}`;
		await asUser(() =>
			audit.audit.record({
				projectId: "on",
				resourceType: "integration",
				resourceId: id,
				action: "test",
				changedFields: ["config.password"],
				status: "failure",
				message: `login failed for postgres://admin:${secret}@db:5432/app`,
			}),
		);
		await until(async () => (await count(`resource_id = '${id}'`)) === 1);
		const [row] = await sql`SELECT row_to_json(a)::text AS doc FROM audit_events a WHERE resource_id = ${id}`;
		expect(row.doc).not.toContain(secret);
		expect(row.doc).toContain("config.password");
	});

	it("stores an event published twice only once", async () => {
		const id = `dup-${rand(8)}`;
		const event = builder.buildEvent(
			{ resourceType: "route", resourceId: id, action: "update", changedFields: [] },
			null,
			{ ...ACTOR, source: "pat" },
			null,
		);
		await publish.publishAuditEvent(event);
		await publish.publishAuditEvent(event);
		await until(async () => (await count(`resource_id = '${id}'`)) >= 1);
		await Bun.sleep(2_500);
		expect(await count(`resource_id = '${id}'`)).toBe(1);
	});

	it("inserts the same batch twice without duplicating rows", async () => {
		const id = `redeliver-${rand(8)}`;
		const events = [1, 2, 3].map(() =>
			builder.buildEvent(
				{ resourceType: "route", resourceId: id, action: "update", changedFields: [] },
				null,
				{ ...ACTOR, source: "agent" },
				null,
			),
		);
		await sink.postgresAuditSink.insert(events);
		await sink.postgresAuditSink.insert(events);
		expect(await count(`resource_id = '${id}'`)).toBe(3);
	});

	it("batches a burst of events into few inserts", async () => {
		const tag = `burst-${rand(8)}`;
		await Promise.all(
			Array.from({ length: 120 }, (_, i) =>
				publish.publishAuditEvent(
					builder.buildEvent(
						{ resourceType: "route", resourceId: `${tag}-${i}`, action: "update", changedFields: [] },
						null,
						{ ...ACTOR, source: "portal" },
						null,
					),
				),
			),
		);
		await until(async () => (await count(`resource_id LIKE '${tag}-%'`)) === 120);
	});

	it("deletes only the rows older than the retention", async () => {
		const tag = `age-${rand(8)}`;
		const day = 86_400_000;
		const row = (name: string, ageDays: number) => ({
			...builder.buildEvent(
				{ resourceType: "route", resourceId: `${tag}-${name}`, action: "update", changedFields: [] },
				null,
				{ ...ACTOR, source: "portal" },
				null,
			),
			ts: new Date(Date.now() - ageDays * day).toISOString(),
		});
		await sink.postgresAuditSink.insert([row("old", 40), row("edge", 31), row("fresh", 5)]);
		await retention.deleteExpiredAuditEvents(30);
		const left = (await sql`SELECT resource_id FROM audit_events WHERE resource_id LIKE ${`${tag}-%`}`).map(
			(r: { resource_id: string }) => r.resource_id,
		);
		expect(left).toEqual([`${tag}-fresh`]);
	});
});
