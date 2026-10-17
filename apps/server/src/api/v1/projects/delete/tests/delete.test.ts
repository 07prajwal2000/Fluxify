// Project delete (#657) against a real Postgres: who may delete, what goes with
// the row, and which broker artifacts are withdrawn. The artifact store and the
// change signal are recorded instead of sent.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";

const PG = { image: "postgres:16-alpine", name: "fluxify-project-delete-pg-test" };
let container: Docker.Container | undefined;
let sql: SQL;
let app: Hono<any>;

const deleted: string[] = [];
const unscheduled: { projectId: string; triggerId: string }[] = [];
const published: { chan: string; id: string }[] = [];

const natsKv = await import("../../../../../db/natsKv");
const pubsub = await import("../../../../../db/pubsub");
const reconciler = await import("../../../../../modules/schedules/reconciler");
const subjects = await import("../../../../../modules/compiler/subjects");

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
	const { migrateDB } = await import("../../../../../db/migration");
	await migrateDB(url);
	sql = new SQL(url);
	mock.module("../../../../../db", () => ({ db: drizzle({ client: sql }) }));

	spyOn(natsKv, "deleteArtifact").mockImplementation(async (key) => {
		deleted.push(key);
	});
	spyOn(natsKv, "deleteArtifactEverywhere").mockImplementation(async (key) => {
		deleted.push(key);
	});
	spyOn(reconciler, "removeScheduleEverywhere").mockImplementation(async (projectId, triggerId) => {
		unscheduled.push({ projectId, triggerId });
	});
	spyOn(pubsub, "publishMessage").mockImplementation(async (chan, id) => {
		published.push({ chan, id: String(id) });
	});

	const deleteProject = (await import("../route")).default;
	const { errorHandler } = await import("../../../../../middlewares/errorHandler");
	app = new Hono<any>();
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		const admin = ctx.req.header("X-Admin") === "1";
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: admin });
		ctx.set("acl", [{ projectId: ctx.req.header("X-Project"), role: ctx.req.header("X-Role") ?? "creator" }]);
		await next();
	});
	deleteProject(app.basePath("/projects"));
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

beforeEach(() => {
	deleted.length = 0;
	unscheduled.length = 0;
	published.length = 0;
});

const short = () => crypto.randomUUID().slice(0, 8);

/** A project with one of each thing it owns; returns the ids the assertions need. */
async function newProject() {
	const id = `p${short()}`;
	const route = `r${short()}`;
	const workflow = `w${short()}`;
	const block = `b${short()}`;
	const middleware = `m${short()}`;
	const sandbox = `s${short()}`;
	const queueTrigger = `t${short()}`;
	const scheduleTrigger = `t${short()}`;
	await sql`INSERT INTO projects (id, name, slug) VALUES (${id}, ${id}, ${id})`;
	await sql`INSERT INTO routes (id, project_id, name, path, method) VALUES (${route}, ${id}, ${route}, ${`/${route}`}, 'GET')`;
	await sql`INSERT INTO workflows (id, project_id, name) VALUES (${workflow}, ${id}, ${workflow})`;
	await sql`INSERT INTO custom_blocks_list (id, project_id, name, label) VALUES (${block}, ${id}, ${block}, ${block})`;
	await sql`INSERT INTO middlewares (id, project_id, name) VALUES (${middleware}, ${id}, ${middleware})`;
	const owner = `u${short()}`;
	await sql`INSERT INTO system_users (id, email, name) VALUES (${owner}, ${`${owner}@example.com`}, ${owner})`;
	await sql`INSERT INTO sandboxes (id, project_id, name, user_id) VALUES (${sandbox}, ${id}, ${sandbox}, ${owner})`;
	await sql`INSERT INTO app_config (project_id, key_name, value) VALUES (${id}, ${`k${short()}`}, 'v')`;
	await sql`INSERT INTO integrations (id, name, project_id) VALUES (gen_random_uuid(), ${`i${short()}`}, ${id})`;
	// a middleware chain uses the block, and a trigger sits in the group: both
	// foreign keys are RESTRICT, the ones a project delete must get past
	await sql`INSERT INTO middleware_blocks (middleware_id, custom_block_id, position) VALUES (${middleware}, ${block}, 0)`;
	const group = `g${short()}`;
	await sql`INSERT INTO trigger_groups (id, name, project_id) VALUES (${group}, ${group}, ${id})`;
	await sql`INSERT INTO triggers (id, name, type, project_id, workflow_id, group_id) VALUES (${queueTrigger}, ${queueTrigger}, 'internal', ${id}, ${workflow}, ${group})`;
	await sql`INSERT INTO triggers (id, name, type, project_id, workflow_id, group_id) VALUES (${scheduleTrigger}, ${scheduleTrigger}, 'schedule', ${id}, ${workflow}, ${group})`;
	return { id, route, workflow, block, middleware, sandbox, queueTrigger, scheduleTrigger };
}

type As = { user?: string; role?: string; admin?: boolean };

async function call(project: string, as: As, method = "DELETE") {
	const headers: Record<string, string> = {
		"X-User": as.user ?? "u-test",
		"X-Project": project,
		"X-Role": as.role ?? "creator",
	};
	if (as.admin) headers["X-Admin"] = "1";
	const res = await app.request(`http://localhost/projects/${project}`, { method, headers });
	return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

async function count(table: string, projectId: string) {
	const [row] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE project_id = $1`, [projectId]);
	return row.n as number;
}

describe("DELETE /projects/:id", () => {
	it("refuses a creator and a project admin, and deletes nothing", async () => {
		const p = await newProject();
		expect((await call(p.id, { role: "creator" })).status).toBe(403);
		expect((await call(p.id, { role: "project_admin" })).status).toBe(403);
		expect(await count("routes", p.id)).toBe(1);
		expect(deleted).toEqual([]);
	});

	it("answers 404 for a project that is not there", async () => {
		const res = await call(`p${short()}`, { admin: true });
		expect(res.status).toBe(404);
	});

	it("a system admin deletes the project and leaves no rows of it behind", async () => {
		const p = await newProject();
		const res = await call(p.id, { admin: true });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ id: p.id });

		const [gone] = await sql`SELECT id FROM projects WHERE id = ${p.id}`;
		expect(gone).toBeUndefined();
		for (const table of [
			"routes",
			"workflows",
			"custom_blocks_list",
			"middlewares",
			"sandboxes",
			"app_config",
			"integrations",
			"triggers",
		]) {
			expect(await count(table, p.id)).toBe(0);
		}
	});

	it("withdraws the artifacts of everything it owned, and stops its triggers", async () => {
		const p = await newProject();
		await call(p.id, { admin: true });

		expect(deleted).toContain(subjects.routeKey(p.id, p.route));
		expect(deleted).toContain(subjects.workflowKey(p.id, p.workflow));
		expect(deleted).toContain(subjects.customBlockKey(p.id, p.block));
		expect(deleted).toContain(subjects.middlewareKey(p.id, p.middleware));
		expect(deleted).toContain(subjects.triggerKey(p.id, p.queueTrigger));
		expect(unscheduled).toEqual([{ projectId: p.id, triggerId: p.scheduleTrigger }]);
		expect(published).toContainEqual({ chan: pubsub.CHAN_ON_ROUTE_CHANGE, id: p.route });
		expect(published).toContainEqual({ chan: pubsub.CHAN_ON_WORKFLOW_CHANGE, id: p.workflow });
	});

	it("leaves another project alone", async () => {
		const mine = await newProject();
		const other = await newProject();
		await call(mine.id, { admin: true });
		expect(await count("routes", other.id)).toBe(1);
		expect(await count("triggers", other.id)).toBe(2);
		expect(deleted).not.toContain(subjects.routeKey(other.id, other.route));
	});
});
