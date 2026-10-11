// Versions (#738) against a real Postgres: commit, history and checkout through
// the HTTP API, so the lock, the snapshot and the restore all run for real. The
// change signal is recorded instead of sent.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import { SQL } from "bun";
import type Docker from "dockerode";
import { drizzle } from "drizzle-orm/bun-sql";
import { Hono } from "hono";

const PG = { image: "postgres:16-alpine", name: "fluxify-versions-pg-test" };
let container: Docker.Container | undefined;
let sql: SQL;
let app: Hono<any>;

const signals: { chan: string; id: unknown }[] = [];

const natsKv = await import("../../../db/natsKv");
const pubsub = await import("../../../db/pubsub");

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
	const { migrateDB } = await import("../../../db/migration");
	await migrateDB(url);
	sql = new SQL(url);
	mock.module("../../../db", () => ({ db: drizzle({ client: sql }) }));

	spyOn(pubsub, "publishMessage").mockImplementation(async (chan, id) => {
		signals.push({ chan: String(chan), id });
	});
	spyOn(natsKv, "deleteArtifactEverywhere").mockImplementation(async () => {});

	const routes = (await import("../../../api/v1/routes/register")).default;
	const workflows = (await import("../../../api/v1/workflows/register")).default;
	const middlewares = (await import("../../../api/v1/middlewares/register")).default;
	const { errorHandler } = await import("../../../middlewares/errorHandler");
	app = new Hono<any>();
	app.onError(errorHandler);
	app.use(async (ctx, next) => {
		const project = ctx.req.header("X-Project");
		ctx.set("user", { id: ctx.req.header("X-User"), isSystemAdmin: false });
		ctx.set("acl", [{ projectId: project, role: ctx.req.header("X-Role") ?? "creator" }]);
		await next();
	});
	routes.registerHandler(app);
	workflows.registerHandler(app);
	middlewares.registerHandler(app);
}, 180_000);

afterAll(async () => {
	await sql?.close().catch(() => {});
	await container?.remove({ force: true }).catch(() => {});
});

beforeEach(() => {
	signals.length = 0;
});

const short = () => crypto.randomUUID().slice(0, 8);

async function newProject() {
	const id = Bun.randomUUIDv7();
	await sql`INSERT INTO projects (id, name, slug) VALUES (${id}, ${id}, ${id})`;
	return id;
}

async function newUser() {
	const id = `u${short()}`;
	await sql`INSERT INTO system_users (id, email, name) VALUES (${id}, ${`${id}@example.com`}, ${null})`;
	return { id, email: `${id}@example.com` };
}

type As = { user: string; project: string; role?: string };

async function call(as: As, method: string, path: string, body?: unknown) {
	const res = await app.request(`http://localhost${path}`, {
		method,
		headers: {
			"X-User": as.user,
			"X-Project": as.project,
			"X-Role": as.role ?? "creator",
			"content-type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function setup() {
	const project = await newProject();
	const author = await newUser();
	return { project, author, as: { user: author.id, project } as As };
}

async function createRoute(as: As, path = `/${short()}`, method = "GET") {
	const res = await call(as, "POST", "/routes", {
		name: `r-${short()}`,
		path,
		method,
		projectId: as.project,
	});
	expect(res.status).toBe(200);
	return res.body.id as string;
}

async function createWorkflow(as: As) {
	const res = await call(as, "POST", "/workflows", { name: `w-${short()}`, projectId: as.project });
	expect(res.status).toBe(200);
	return res.body.id as string;
}

/** the canvas of a route or workflow */
async function canvas(as: As, kind: string, id: string) {
	return (await call(as, "GET", `/${kind}/${id}/canvas-items`)).body;
}

const JS = Bun.randomUUIDv7();
const REPLY = Bun.randomUUIDv7();

/** one JS block between the entrypoint and a response; calling again changes its script */
async function edit(as: As, kind: string, id: string, script: string) {
	const entry = (await canvas(as, kind, id)).blocks.find((b: any) => b.type === "entrypoint").id;
	const edges = [
		{ id: Bun.randomUUIDv7(), from: entry, to: JS, fromHandle: `${entry}-source`, toHandle: `${JS}-target` },
		{ id: Bun.randomUUIDv7(), from: JS, to: REPLY, fromHandle: `${JS}-source`, toHandle: `${REPLY}-target` },
	];
	const blocks = [
		{ id: JS, type: "jsrunner", position: { x: 240, y: 0 }, data: { value: script } },
		{ id: REPLY, type: "response", position: { x: 480, y: 0 }, data: { httpCode: "200" } },
	];
	const first = !(await canvas(as, kind, id)).blocks.some((b: any) => b.id === JS);
	const res = await call(as, "PUT", `/${kind}/${id}/save-canvas`, {
		actionsToPerform: {
			blocks: blocks.map((b) => ({ id: b.id, action: "upsert" })),
			edges: first ? edges.map((e) => ({ id: e.id, action: "upsert" })) : [],
		},
		changes: { blocks, edges: first ? edges : [] },
	});
	expect(res.status).toBe(200);
}

const commit = (as: As, kind: string, id: string, title: string, description?: string) =>
	call(as, "POST", `/${kind}/${id}/versions`, { title, description });

const checkout = (as: As, kind: string, id: string, versionId: string, title?: string) =>
	call(as, "POST", `/${kind}/${id}/versions/${versionId}/checkout`, { title });

const list = async (as: As, kind: string, id: string) =>
	(await call(as, "GET", `/${kind}/${id}/versions`)).body;

const script = async (as: As, kind: string, id: string) =>
	(await canvas(as, kind, id)).blocks.find((b: any) => b.id === JS)?.data.value;

describe("commit, list and get", () => {
	it("commits the working copy as v1, then refuses with nothing to commit", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");

		const first = await commit(as, "routes", id, "First cut", "the first one");
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({
			versionNumber: 1,
			title: "First cut",
			description: "the first one",
			parentId: null,
			isHead: true,
			kind: "route",
			targetId: id,
		});

		const again = await commit(as, "routes", id, "Again");
		expect(again.status).toBe(409);
		expect(again.body.message).toBe("Nothing to commit");
	});

	it("lists newest first with the author, and reports uncommitted work", async () => {
		const { as, author } = await setup();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");
		await commit(as, "routes", id, "One");
		await edit(as, "routes", id, "return 2;");
		await commit(as, "routes", id, "Two");

		let history = await list(as, "routes", id);
		expect(history.uncommitted).toBe(false);
		expect(history.versions.map((v: any) => [v.versionNumber, v.title, v.isHead])).toEqual([
			[2, "Two", true],
			[1, "One", false],
		]);
		expect(history.versions[0]).toMatchObject({ author: author.email, authorEmail: author.email });
		expect(history.versions[0].parentId).toBe(history.versions[1].id);

		await edit(as, "routes", id, "return 3;");
		history = await list(as, "routes", id);
		expect(history.uncommitted).toBe(true);
	});

	it("returns one version with its blocks, edges and settings", async () => {
		const { as } = await setup();
		const id = await createRoute(as, "/shape", "POST");
		await edit(as, "routes", id, "return 7;");
		const created = (await commit(as, "routes", id, "Seven")).body;

		const one = await call(as, "GET", `/routes/${id}/versions/${created.id}`);
		expect(one.status).toBe(200);
		expect(one.body.snapshot.settings).toMatchObject({
			path: "/shape",
			method: "POST",
			timeoutSeconds: 30,
			middlewares: { before: [], after: [] },
		});
		const js = one.body.snapshot.blocks.find((b: any) => b.id === JS);
		expect(js).toMatchObject({ type: "jsrunner", data: { value: "return 7;" } });
		expect(js.key).toBeTruthy();
		expect(one.body.snapshot.edges.length).toBe(2);
	});

	it("answers 404 for a version that is not this route's", async () => {
		const { as } = await setup();
		const a = await createRoute(as);
		const b = await createRoute(as);
		await edit(as, "routes", a, "return 1;");
		const version = (await commit(as, "routes", a, "A")).body;

		expect((await call(as, "GET", `/routes/${b}/versions/${version.id}`)).status).toBe(404);
		expect((await checkout(as, "routes", b, version.id)).status).toBe(404);
		expect((await call(as, "GET", `/routes/${a}/versions/${Bun.randomUUIDv7()}`)).status).toBe(404);
	});

	it("never changes a stored version when the work moves on", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");
		const v1 = (await commit(as, "routes", id, "One")).body;
		await edit(as, "routes", id, "return 2;");
		await commit(as, "routes", id, "Two");

		const one = await call(as, "GET", `/routes/${id}/versions/${v1.id}`);
		expect(one.body.snapshot.blocks.find((b: any) => b.id === JS).data.value).toBe("return 1;");
	});
});

describe("checkout", () => {
	it("saves uncommitted work as v4 and the next commit hangs off the checked-out version (#738)", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const numbers: Record<number, any> = {};
		for (const n of [1, 2, 3]) {
			await edit(as, "routes", id, `return ${n};`);
			numbers[n] = (await commit(as, "routes", id, `v${n}`)).body;
		}
		await edit(as, "routes", id, "return 99;");

		const out = await checkout(as, "routes", id, numbers[3].id);
		expect(out.status).toBe(200);
		expect(out.body.savedVersion).toMatchObject({
			versionNumber: 4,
			title: "Saved before checking out v3",
			parentId: numbers[3].id,
			isHead: false,
		});
		expect(out.body.checkedOut).toMatchObject({ versionNumber: 3, isHead: true });
		expect(await script(as, "routes", id)).toBe("return 3;");

		const route = (await call(as, "GET", `/routes/${id}`)).body;
		expect(route).toMatchObject({ headVersionNumber: 3, uncommitted: false });

		await edit(as, "routes", id, "return 5;");
		const v5 = await commit(as, "routes", id, "v5");
		expect(v5.body).toMatchObject({ versionNumber: 5, parentId: numbers[3].id });
		expect((await list(as, "routes", id)).versions.map((v: any) => v.versionNumber)).toEqual([5, 4, 3, 2, 1]);
	});

	it("uses the title it is given for the saved work, and checks out cleanly when there is none", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");
		const v1 = (await commit(as, "routes", id, "One")).body;
		await edit(as, "routes", id, "return 2;");

		const named = await checkout(as, "routes", id, v1.id, "Half done rate limit");
		expect(named.body.savedVersion.title).toBe("Half done rate limit");

		const clean = await checkout(as, "routes", id, v1.id);
		expect(clean.status).toBe(200);
		expect(clean.body.savedVersion).toBeUndefined();
	});

	it("keeps block ids and keys, and never hands a key out twice", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");
		const v1 = (await commit(as, "routes", id, "One")).body;
		const before = (await canvas(as, "routes", id)).blocks;

		// a second JS block takes the next key, then goes away again
		const extra = Bun.randomUUIDv7();
		await call(as, "PUT", `/routes/${id}/save-canvas`, {
			actionsToPerform: { blocks: [{ id: extra, action: "upsert" }], edges: [] },
			changes: {
				blocks: [{ id: extra, type: "jsrunner", position: { x: 0, y: 200 }, data: { value: "return 0;" } }],
				edges: [],
			},
		});
		const extraKey = (await canvas(as, "routes", id)).blocks.find((b: any) => b.id === extra).key;
		await checkout(as, "routes", id, v1.id, "scratch");

		const after = (await canvas(as, "routes", id)).blocks;
		expect(after.map((b: any) => [b.id, b.key]).sort()).toEqual(before.map((b: any) => [b.id, b.key]).sort());
		expect(after.some((b: any) => b.id === extra)).toBe(false);

		const again = Bun.randomUUIDv7();
		await call(as, "PUT", `/routes/${id}/save-canvas`, {
			actionsToPerform: { blocks: [{ id: again, action: "upsert" }], edges: [] },
			changes: {
				blocks: [{ id: again, type: "jsrunner", position: { x: 0, y: 200 }, data: { value: "return 0;" } }],
				edges: [],
			},
		});
		const newKey = (await canvas(as, "routes", id)).blocks.find((b: any) => b.id === again).key;
		expect(newKey).not.toBe(extraKey);
	});

	it("restores path, method, schemas, timeout and middlewares, and leaves name and switches alone", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as, "/orders", "GET");
		const mw = Bun.randomUUIDv7();
		await sql`INSERT INTO middlewares (id, project_id, name) VALUES (${mw}, ${project}, 'auth')`;
		const schema = { dataType: "object", properties: [{ key: "page", dataType: "str" }] };
		const patched = await call(as, "PATCH", `/routes/partial/${id}`, {
			timeoutSeconds: 45,
			querySchema: schema,
		});
		expect(patched.status).toBe(200);
		expect((await call(as, "PUT", `/routes/${id}/middlewares`, { before: [mw], after: [] })).status).toBe(200);
		await edit(as, "routes", id, "return 1;");
		const v1 = (await commit(as, "routes", id, "Orders")).body;

		await call(as, "PATCH", `/routes/partial/${id}`, {
			path: "/orders-v2",
			method: "POST",
			timeoutSeconds: 90,
			querySchema: null,
			name: "renamed-route",
			active: true,
			devActive: false,
		});
		await call(as, "PUT", `/routes/${id}/middlewares`, { before: [], after: [] });

		const out = await checkout(as, "routes", id, v1.id, "wip");
		expect(out.status).toBe(200);
		const route = (await call(as, "GET", `/routes/${id}`)).body;
		expect(route).toMatchObject({
			path: "/orders",
			method: "GET",
			timeoutSeconds: 45,
			querySchema: schema,
			// live settings are not versioned
			name: "renamed-route",
			active: true,
			devActive: false,
		});
		const detail = (await call(as, "GET", `/routes/${id}/versions/${v1.id}`)).body;
		expect(detail.snapshot.settings.middlewares).toEqual({ before: [mw], after: [] });
		const attached = await sql`SELECT middleware_id FROM route_middlewares WHERE route_id = ${id}`;
		expect(attached.map((r: any) => r.middleware_id)).toEqual([mw]);
	});

	it("sends the usual change signal after a checkout, and none after a commit", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");
		signals.length = 0;
		const v1 = (await commit(as, "routes", id, "One")).body;
		expect(signals).toEqual([]);

		await edit(as, "routes", id, "return 2;");
		signals.length = 0;
		await checkout(as, "routes", id, v1.id, "wip");
		expect(signals).toEqual([{ chan: pubsub.CHAN_ON_ROUTE_CHANGE, id }]);
	});

	it("refuses a path another route took since, and changes nothing", async () => {
		const { as } = await setup();
		const a = await createRoute(as, `/clash-${short()}`, "GET");
		const path = (await call(as, "GET", `/routes/${a}`)).body.path;
		await edit(as, "routes", a, "return 1;");
		const v1 = (await commit(as, "routes", a, "A")).body;
		await call(as, "PATCH", `/routes/partial/${a}`, { path: `/moved-${short()}` });
		await createRoute(as, path, "GET");
		await edit(as, "routes", a, "return 2;");
		const versionsBefore = (await list(as, "routes", a)).versions.length;

		const out = await checkout(as, "routes", a, v1.id);
		expect(out.status).toBe(409);
		expect((await list(as, "routes", a)).versions.length).toBe(versionsBefore);
		expect(await script(as, "routes", a)).toBe("return 2;");
	});

	it("does the same for workflows", async () => {
		const { as } = await setup();
		const id = await createWorkflow(as);
		await edit(as, "workflows", id, "return 1;");
		await call(as, "PATCH", `/workflows/${id}`, { timeoutSeconds: 120 });
		const v1 = (await commit(as, "workflows", id, "One")).body;
		expect(v1).toMatchObject({ kind: "workflow", versionNumber: 1, targetId: id });
		await edit(as, "workflows", id, "return 2;");
		await call(as, "PATCH", `/workflows/${id}`, { timeoutSeconds: 600 });

		const out = await checkout(as, "workflows", id, v1.id);
		expect(out.body.savedVersion.versionNumber).toBe(2);
		const workflow = (await call(as, "GET", `/workflows/${id}`)).body;
		expect(workflow).toMatchObject({ timeoutSeconds: 120, headVersionNumber: 1, uncommitted: false });
		expect(await script(as, "workflows", id)).toBe("return 1;");
		expect(signals.at(-1)).toEqual({ chan: pubsub.CHAN_ON_WORKFLOW_CHANGE, id });
	});
});

describe("what moves the revision", () => {
	it("a versioned setting makes the work uncommitted, a name or a switch does not", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");
		await commit(as, "routes", id, "One");
		const uncommitted = async () => (await call(as, "GET", `/routes/${id}`)).body.uncommitted;

		await call(as, "PATCH", `/routes/partial/${id}`, { name: "other-name", active: true, tracingEnabled: true });
		expect(await uncommitted()).toBe(false);
		// the same value again changes nothing either
		await call(as, "PATCH", `/routes/partial/${id}`, { timeoutSeconds: 30 });
		expect(await uncommitted()).toBe(false);

		await call(as, "PATCH", `/routes/partial/${id}`, { timeoutSeconds: 60 });
		expect(await uncommitted()).toBe(true);
	});

	it("attaching a middleware does, and putting the same ones back does not", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		const mw = Bun.randomUUIDv7();
		await sql`INSERT INTO middlewares (id, project_id, name) VALUES (${mw}, ${project}, 'log')`;
		await edit(as, "routes", id, "return 1;");
		await commit(as, "routes", id, "One");
		const uncommitted = async () => (await call(as, "GET", `/routes/${id}`)).body.uncommitted;

		await call(as, "PUT", `/routes/${id}/middlewares`, { before: [], after: [] });
		expect(await uncommitted()).toBe(false);
		await call(as, "PUT", `/routes/${id}/middlewares`, { before: [mw], after: [] });
		expect(await uncommitted()).toBe(true);
	});
});

describe("who can do what, and what goes with what", () => {
	it("lets a viewer read the history but not commit or check out", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");
		const v1 = (await commit(as, "routes", id, "One")).body;
		await edit(as, "routes", id, "return 2;");
		const viewer: As = { user: (await newUser()).id, project, role: "viewer" };

		expect((await call(viewer, "GET", `/routes/${id}/versions`)).status).toBe(200);
		expect((await call(viewer, "GET", `/routes/${id}/versions/${v1.id}`)).status).toBe(200);
		expect((await commit(viewer, "routes", id, "Nope")).status).toBe(403);
		expect((await checkout(viewer, "routes", id, v1.id)).status).toBe(403);
	});

	it("is a 403 to someone outside the project", async () => {
		const { as } = await setup();
		const id = await createRoute(as);
		const stranger: As = { user: (await newUser()).id, project: await newProject() };
		expect((await call(stranger, "GET", `/routes/${id}/versions`)).status).toBe(403);
	});

	it("keeps the author's email when the user is deleted", async () => {
		const { as, project } = await setup();
		const leaver = await newUser();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");
		await commit({ user: leaver.id, project }, "routes", id, "By someone who left");

		await sql`DELETE FROM system_users WHERE id = ${leaver.id}`;
		const [version] = (await list(as, "routes", id)).versions;
		expect(version).toMatchObject({ author: leaver.email, authorEmail: leaver.email });
		const [row] = await sql`SELECT author_id, author_email FROM canvas_versions WHERE route_id = ${id}`;
		expect(row).toEqual({ author_id: null, author_email: leaver.email });
	});

	it("deletes the versions with their route and workflow", async () => {
		const { as } = await setup();
		const route = await createRoute(as);
		const workflow = await createWorkflow(as);
		await edit(as, "routes", route, "return 1;");
		await commit(as, "routes", route, "One");
		await edit(as, "workflows", workflow, "return 1;");
		await commit(as, "workflows", workflow, "One");

		expect((await call(as, "DELETE", `/routes/${route}`)).status).toBe(204);
		expect((await call(as, "DELETE", `/workflows/${workflow}`)).status).toBe(200);
		const [left] = await sql`
			SELECT count(*)::int AS n FROM canvas_versions WHERE route_id = ${route} OR workflow_id = ${workflow}`;
		expect(left.n).toBe(0);
	});

	it("goes with its project, head pointer and parent links included", async () => {
		const { as, project } = await setup();
		const id = await createRoute(as);
		await edit(as, "routes", id, "return 1;");
		await commit(as, "routes", id, "One");
		await edit(as, "routes", id, "return 2;");
		await commit(as, "routes", id, "Two");

		await sql`DELETE FROM projects WHERE id = ${project}`;
		const [left] = await sql`SELECT count(*)::int AS n FROM canvas_versions WHERE project_id = ${project}`;
		expect(left.n).toBe(0);
	});
});
