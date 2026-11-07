// AI canvas reviews (#754) against a real Postgres: one row per target, the
// upsert that replaces it, and the "only while running under this id" guard
// that keeps a stopped or replaced review from being overwritten.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { migrateDB } from "@fluxify/server/src/db/migration";
import { SQL } from "bun";
import type Docker from "dockerode";

const PG = { image: "postgres:16-alpine", name: "fluxify-agent-reviews-pg-test" };
let container: Docker.Container | undefined;
let sql: SQL;
let repo: typeof import("./repository");

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
	await migrateDB(url);
	sql = new SQL(url);
	const server = await import("@fluxify/server");
	// The env is read once per process, maybe before this file ran: point PG_URL here for the init only.
	const env = await import("@fluxify/server/src/lib/env");
	const realEnv = env.getEnv;
	const pgUrl = spyOn(env, "getEnv").mockImplementation((k) => (k === "PG_URL" ? url : realEnv(k)));
	await server.drizzleInit(false);
	pgUrl.mockRestore();
	repo = await import("./repository");
	await sql`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop'), ('p2', 'Other', 'other')`;
	await sql`INSERT INTO system_users (id, name, email) VALUES ('u1', 'Ada', 'ada@x.io')`;
	await sql`INSERT INTO routes (id, name, path, project_id, canvas_revision) VALUES ('r1', 'Users', '/users', 'p1', 4)`;
	await sql`INSERT INTO workflows (id, name, project_id) VALUES ('w1', 'Nightly', 'p1')`;
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

const finding = {
	severity: "warning" as const,
	category: "correctness" as const,
	message: "m",
	blockKeys: ["if_1"],
	blockIds: ["b1"],
};

describe("agent reviews", () => {
	it("reads a target's revision only inside its own project", async () => {
		expect(await repo.targetRevision("route", "r1", "p1")).toBe(4);
		expect(await repo.targetRevision("workflow", "w1", "p1")).toBe(0);
		expect(await repo.targetRevision("route", "r1", "p2")).toBeUndefined();
		expect(await repo.targetRevision("workflow", "r1", "p1")).toBeUndefined();
	});

	it("keeps one review per target; a new one replaces the last under a new id", async () => {
		const first = await repo.startReview("route", "r1", "p1", "u1");
		expect(first.status).toBe("running");
		expect(
			await repo.finishReview(first.id, {
				canvasRevision: 4,
				summary: "s",
				findings: [finding],
				usage: { inputTokens: 1, outputTokens: 2 },
			}),
		).toBe(true);
		const done = await repo.getReview("route", "r1", "p1");
		expect(done).toMatchObject({ status: "completed", canvasRevision: 4, findings: [finding] });
		expect(done?.completedAt).toBeInstanceOf(Date);

		const second = await repo.startReview("route", "r1", "p1", "u1");
		expect(second.id).not.toBe(first.id);
		const now = await repo.getReview("route", "r1", "p1");
		// the old report is gone, not kept beside the new one
		expect(now).toMatchObject({
			id: second.id,
			status: "running",
			summary: null,
			findings: null,
			canvasRevision: null,
			completedAt: null,
		});
		const [{ count }] = await sql`SELECT count(*)::int AS count FROM agent_reviews WHERE target_id = 'r1'`;
		expect(count).toBe(1);
		// another project never sees it
		expect(await repo.getReview("route", "r1", "p2")).toBeUndefined();
	});

	it("a stopped or replaced review is never written over", async () => {
		const stopped = await repo.startReview("workflow", "w1", "p1", "u1");
		expect(await repo.touchReview(stopped.id)).toBe(true);
		expect(await repo.endReview(stopped.id, "cancelled")).toBe(true);
		// the job, finishing late, changes nothing
		expect(await repo.touchReview(stopped.id)).toBe(false);
		expect(
			await repo.finishReview(stopped.id, {
				canvasRevision: 0,
				summary: "late",
				findings: [],
				usage: { inputTokens: 0, outputTokens: 0 },
			}),
		).toBe(false);
		expect((await repo.getReview("workflow", "w1", "p1"))?.status).toBe("cancelled");

		const old = await repo.startReview("workflow", "w1", "p1", "u1");
		const fresh = await repo.startReview("workflow", "w1", "p1", "u1");
		expect(await repo.endReview(old.id, "failed", "late")).toBe(false);
		expect(await repo.getReview("workflow", "w1", "p1")).toMatchObject({
			id: fresh.id,
			status: "running",
			error: null,
		});
	});

	it("marks one finding of a finished report, and nothing on a replaced one", async () => {
		await sql`INSERT INTO workflows (id, name, project_id) VALUES ('w2', 'Fixes', 'p1')`;
		const r = await repo.startReview("workflow", "w2", "p1", "u1");
		const other = { ...finding, message: "other" };
		await repo.finishReview(r.id, {
			canvasRevision: 0,
			summary: "s",
			findings: [finding, other],
			usage: { inputTokens: 0, outputTokens: 0 },
		});
		const fixed = { status: "fixed" as const, note: "Added suites", conversationId: "c1", at: "t" };
		expect(await repo.resolveFinding(r.id, "p1", 1, fixed)).toBe(true);
		expect((await repo.getReview("workflow", "w2", "p1"))?.findings).toEqual([
			finding,
			{ ...other, resolution: fixed },
		]);
		// no such finding, another project, or a report replaced since
		expect(await repo.resolveFinding(r.id, "p1", 2, fixed)).toBe(false);
		expect(await repo.resolveFinding(r.id, "p2", 0, fixed)).toBe(false);
		await repo.startReview("workflow", "w2", "p1", "u1");
		expect(await repo.resolveFinding(r.id, "p1", 0, fixed)).toBe(false);
	});

	it("goes with its project", async () => {
		await sql`INSERT INTO routes (id, name, path, project_id) VALUES ('r2', 'Gone', '/gone', 'p2')`;
		await repo.startReview("route", "r2", "p2", "u1");
		await sql`DELETE FROM projects WHERE id = 'p2'`;
		const [{ count }] = await sql`SELECT count(*)::int AS count FROM agent_reviews WHERE project_id = 'p2'`;
		expect(count).toBe(0);
	});
});
