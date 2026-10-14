// Archived-conversation retention (#721) against a real Postgres: the daily tick
// deletes chats archived past the window, with their runs and messages, and
// leaves the recent, the unarchived, the never-archived and the running alone.
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrateDB } from "../../../db/migration";

const IMAGE = "postgres:16-alpine";
const NAME = "fluxify-agent-retention-pg-test";
let container: Docker.Container;
let sql: SQL;
let retention: typeof import("../retention");

beforeAll(async () => {
	await docker.getContainer(NAME).remove({ force: true }).catch(() => {});
	await pullImage(IMAGE);
	const started = await startContainerWithRandomPort((host) =>
		docker.createContainer({
			Image: IMAGE,
			name: NAME,
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
	mock.module("../../../db", () => ({ db: drizzle({ client: sql }) }));
	retention = await import("../retention");

	await sql`INSERT INTO system_users (id, email, name) VALUES ('u1', 'ada@example.com', 'Ada')`;
	await sql`INSERT INTO projects (id, name, slug) VALUES ('p1', 'Shop', 'shop')`;
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

const DAY = 24 * 60 * 60_000;
const conversation = (id: string, archived: boolean, archivedAt: Date | null, status: string) =>
	sql`INSERT INTO agent_conversations (id, user_id, project_id, archived, archived_at, status)
		VALUES (${id}, 'u1', 'p1', ${archived}, ${archivedAt}, ${status})`;

describe("agent conversation retention", () => {
	it("deletes chats archived past the window, cascading their runs and messages", async () => {
		// archived 8 days ago: gone, with its run and messages
		await conversation("old", true, new Date(Date.now() - 8 * DAY), "completed");
		await sql`INSERT INTO agent_runs (id, conversation_id, user_query, status) VALUES ('old-run', 'old', 'q', 'completed')`;
		await sql`INSERT INTO agent_messages (id, conversation_id, run_id, seq, role, content) VALUES ('old-msg', 'old', 'old-run', 1, 'user', '{}')`;
		// archived 6 days ago: still here
		await conversation("recent", true, new Date(Date.now() - 6 * DAY), "completed");
		// archived then unarchived before day 7: still here
		await conversation("unarchived", false, null, "completed");
		// never archived: never deleted
		await conversation("never", false, null, "idle");
		// archived long ago but a run is in progress: skipped, picked up later
		await conversation("running", true, new Date(Date.now() - 30 * DAY), "running");
		await conversation("waiting", true, new Date(Date.now() - 30 * DAY), "paused_hitl");

		const deleted = await retention.deleteExpiredAgentConversations();

		expect(deleted).toBe(1);
		const ids = (await sql`SELECT id FROM agent_conversations ORDER BY id`).map(
			(r: { id: string }) => r.id,
		);
		expect(ids).toEqual(["never", "recent", "running", "unarchived", "waiting"]);
		expect(await sql`SELECT id FROM agent_runs`).toHaveLength(0);
		expect(await sql`SELECT id FROM agent_messages`).toHaveLength(0);
	});

	it("is idempotent: a second tick deletes nothing", async () => {
		expect(await retention.deleteExpiredAgentConversations()).toBe(0);
	});

	it("works in batches, catching up past the batch size in one tick", async () => {
		await sql`INSERT INTO agent_conversations (id, user_id, project_id, archived, archived_at, status)
			SELECT 'bulk-' || g, 'u1', 'p1', true, now() - interval '8 days', 'completed'
			FROM generate_series(1, 150) g`;

		expect(await retention.deleteExpiredAgentConversations()).toBe(150);
		expect(
			(await sql`SELECT count(*)::int AS n FROM agent_conversations WHERE id LIKE 'bulk-%'`)[0].n,
		).toBe(0);
	});
});
