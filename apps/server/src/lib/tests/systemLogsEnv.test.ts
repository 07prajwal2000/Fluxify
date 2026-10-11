// The system logs `env` filter (#737) against a real Postgres: runtime rows
// carry their env, compile and orchestrator rows carry none and match both.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";

const PG = { image: "postgres:16-alpine", name: "fluxify-system-logs-env-pg-test" };
const PROJECT = `p_${crypto.randomUUID().slice(0, 8)}`;
let container: Docker.Container | undefined;
let sql: SQL | undefined;
let logs: typeof import("../systemLogs");

beforeAll(async () => {
	await docker.getContainer(PG.name).remove({ force: true }).catch(() => {});
	await pullImage(PG.image);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: PG.image,
			name: PG.name,
			Env: ["POSTGRES_PASSWORD=postgres"],
			HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: String(host) }] } },
			ExposedPorts: { "5432/tcp": {} },
		}),
	);
	container = started.container;
	const url = `postgres://postgres:postgres@127.0.0.1:${started.port}/postgres`;
	for (let i = 0; ; i++) {
		const probe = new SQL(url, { max: 1 });
		try {
			await probe`SELECT 1`;
			break;
		} catch (error) {
			if (i >= 90) throw error;
			await Bun.sleep(500);
		} finally {
			await probe.close().catch(() => {});
		}
	}
	const { migrateDB } = await import("../../db/migration");
	await migrateDB(url);
	sql = new SQL(url);
	mock.module("../../db", () => ({ db: drizzle({ client: sql! }) }));
	logs = await import("../systemLogs");
	const entry = (type: string, resourceId: string, env?: string) => ({
		projectId: PROJECT,
		resourceType: "route",
		resourceId,
		type,
		message: `${type} ${env ?? "none"}`,
		...(env && { detail: { env } }),
	});
	await logs.systemLog.error(entry("runtime", "r1", "development"));
	await logs.systemLog.error(entry("runtime", "r1", "production"));
	await logs.systemLog.info(entry("compile", "r1"));
	await logs.systemLog.info(entry("orchestrator", "r1"));
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

const messages = async (env?: "development" | "production") =>
	(await logs.listSystemLogs({ projectId: PROJECT, env }, "u1")).map((l) => l.message).sort();

describe("system logs env filter", () => {
	it("without env, every row comes back", async () => {
		expect(await messages()).toEqual([
			"compile none",
			"orchestrator none",
			"runtime development",
			"runtime production",
		]);
	});

	it("development: its runtime errors, plus the rows that carry no env", async () => {
		expect(await messages("development")).toEqual([
			"compile none",
			"orchestrator none",
			"runtime development",
		]);
	});

	it("production: its runtime errors, plus the rows that carry no env", async () => {
		expect(await messages("production")).toEqual([
			"compile none",
			"orchestrator none",
			"runtime production",
		]);
	});
});
