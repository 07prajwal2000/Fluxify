// Rolling a project back in place (#1130), against a real Postgres and NATS, over
// the HTTP API. The issue's example: the backup holds routes x and y; since then
// x was broken and promoted, and z was added. Keep extras brings x and y back and
// leaves z; exact replica removes z too. Either way x and y keep their ids, their
// working copy and production equal the backup's, and their history is kept. A
// full backup is taken first, and a failure of it changes nothing.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Stack } from "../../../../modules/deployments/tests/blockHarness";
import { type As, prodSnapshot, rollbackStack, scriptOf } from "./rollbackHarness";

let h: Awaited<ReturnType<typeof rollbackStack>>;
let stack: Stack;
let compileProject: (projectId: string) => Promise<void>;

beforeAll(async () => {
	h = await rollbackStack("rollback");
	stack = h.stack;
	compileProject = (await import("../../../../modules/compiler/project")).compileProject;
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

/** a route that says `script`, promoted */
async function live(as: As, script: string) {
	const id = await stack.createRoute(as);
	await stack.setScript(as, "routes", id, script);
	await stack.release(as, "routes", id);
	return id;
}

/** x and y backed up; then x broken and promoted, z added */
async function messedUp() {
	const { as, project } = await stack.setup();
	const x = await live(as, "return 'x-good';");
	const y = await live(as, "return 'y';");
	const bytes = await h.archive(project);
	await stack.setScript(as, "routes", x, "return 'x-broken';");
	await stack.release(as, "routes", x);
	const z = await live(as, "return 'z';");
	return { as, project, x, y, z, bytes };
}

const routeIds = async (project: string) =>
	(await stack.sql`SELECT id FROM routes WHERE project_id = ${project}`).map((r: any) => r.id).sort();

const versions = async (id: string) =>
	(await stack.sql`SELECT version_number, title FROM canvas_versions WHERE route_id = ${id} ORDER BY version_number`) as {
		version_number: number;
		title: string;
	}[];

async function expectBackAsBackedUp(as: As, x: string, y: string) {
	expect(scriptOf(await stack.canvas(as, "routes", x))).toBe("return 'x-good';");
	expect(scriptOf((await prodSnapshot(stack, "routes", x))!)).toBe("return 'x-good';");
	expect(scriptOf((await prodSnapshot(stack, "routes", y))!)).toBe("return 'y';");
	// history kept: the good and the broken release, then the rollback on top
	const xs = await versions(x);
	expect(xs.slice(0, 2).map((v) => v.version_number)).toEqual([1, 2]);
	expect(xs[2]!.title).toStartWith("Rolled back: production");
	// production serves the restored version once the project compiles
	await compileProject(as.project);
	expect(JSON.stringify(await stack.routeArtifact(as.project, x, "production"))).toContain("x-good");
}

describe("roll back in place", () => {
	it("previews what each mode would change, writing nothing", async () => {
		const { as, x, y, z, bytes } = await messedUp();
		const [xName, yName, zName] = await Promise.all(
			[x, y, z].map(async (id) => (await stack.sql`SELECT name FROM routes WHERE id = ${id}`)[0].name),
		);
		const res = await h.inspect(as, bytes);
		expect(res.status).toBe(200);
		const routes = res.body.rollback.sections.find((s: any) => s.section === "routes");
		expect(routes.update.sort()).toEqual([xName, yName].sort());
		expect(routes.create).toEqual([]);
		expect(routes.extras).toEqual([zName]);
		expect(res.body.rollback.conflicts).toEqual([]);
		expect(await h.history(as)).toEqual([]);
	});

	it("keep extras: x and y come back with their ids, z stays", async () => {
		const { as, project, x, y, z, bytes } = await messedUp();
		const res = await h.rollback(as, bytes, "keep");
		expect(res.status).toBe(200);
		expect(await routeIds(project)).toEqual([x, y, z].sort());
		await expectBackAsBackedUp(as, x, y);
		expect(scriptOf(await stack.canvas(as, "routes", z))).toBe("return 'z';");
	});

	it("exact replica: x and y come back with their ids, z is removed and unpublished", async () => {
		const { as, project, x, y, z, bytes } = await messedUp();
		await compileProject(project);
		expect(await stack.routeArtifact(project, z, "production")).not.toBeNull();

		const res = await h.rollback(as, bytes, "exact");
		expect(res.status).toBe(200);
		expect(await routeIds(project)).toEqual([x, y].sort());
		await expectBackAsBackedUp(as, x, y);
		expect(await stack.routeArtifact(project, z, "production")).toBeNull();
	});

	it("takes a full backup of the project as it was, before writing anything", async () => {
		const { as, x, bytes } = await messedUp();
		const res = await h.rollback(as, bytes, "keep");
		expect(res.status).toBe(200);
		const [safety] = await h.history(as);
		expect(safety).toMatchObject({
			id: res.body.backupId,
			label: "Before rollback",
			type: "manual",
			mode: "backup",
			status: "succeeded",
			downloadable: true,
		});
		expect(safety.sections).toEqual(h.ALL);
		// it holds the broken x: it was taken before the rollback wrote
		const download = await stack.app.request(
			`http://localhost/${as.project}/backups/${safety.id}/download`,
			{ headers: { "X-User": as.user, "X-Project": as.project } },
		);
		const saved = new Uint8Array(await download.arrayBuffer());
		const routes = await h.sectionOf(saved, "routes");
		const [name] = (await stack.sql`SELECT name FROM routes WHERE id = ${x}`).map((r: any) => r.name);
		const before = routes.routes.find((r: any) => r.name === name);
		expect(scriptOf(before.history.working)).toBe("return 'x-broken';");
	});

	it("changes nothing when the backup taken first fails", async () => {
		const { as, project, x, y, z, bytes } = await messedUp();
		const sources = h.BACKUP_MODULES.find((m) => m.name === "knowledgeSources")!;
		const boom = spyOn(sources, "export").mockRejectedValue(new Error("disk on fire"));
		const res = await h.rollback(as, bytes, "exact");
		boom.mockRestore();

		expect(res.status).toBe(400);
		expect(res.body.message).toContain("The backup taken before rolling back failed");
		expect(await routeIds(project)).toEqual([x, y, z].sort());
		expect(scriptOf(await stack.canvas(as, "routes", x))).toBe("return 'x-broken';");
		const [failed] = await h.history(as);
		expect(failed).toMatchObject({ label: "Before rollback", status: "failed" });
	});

	it("refuses sections the archive doesn't hold, and a creator-less caller", async () => {
		const { as, bytes } = await messedUp();
		const unknown = await h.rollback(as, bytes, "keep", ["nope"]);
		expect(unknown.status).toBe(400);
		const viewer = await h.rollback({ ...as, role: "viewer" }, bytes, "keep");
		expect(viewer.status).toBe(403);
		expect(await h.history(as)).toEqual([]);
	});
});
