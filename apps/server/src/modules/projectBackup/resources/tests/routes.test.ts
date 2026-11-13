// Routes in a project backup (#1097), against a real Postgres and NATS: a route
// that calls a custom block, runs a middleware and has a test suite is built and
// promoted through the HTTP API, backed up, restored into a new project, and the
// real project compile must publish the restored promoted version to production
// with no promotion of its own.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createStack, type Stack } from "../../../deployments/tests/blockHarness";
import { createBackup } from "../../backup";
import { readBackup, restoreBackup } from "../../restore";
import type { BackupModule } from "../../types";
import { appConfigModule } from "../appConfig";
import { customBlocksModule } from "../customBlocks";
import { integrationsModule } from "../integrations";
import { pluginsModule } from "../plugins";
import { middlewaresModule } from "../middlewares";
import { routesModule } from "../routes";

const MODULES = [appConfigModule, integrationsModule, pluginsModule, customBlocksModule, middlewaresModule, routesModule] as BackupModule[];
const FIXTURES = join(import.meta.dir, "..", "fixtures");

let stack: Stack;
let db: any;
let schema: typeof import("../../../../db/schema");
let compileProject: (projectId: string) => Promise<void>;

beforeAll(async () => {
	stack = await createStack("backuproutes");
	db = (await import("../../../../db")).db;
	schema = await import("../../../../db/schema");
	// what `requestProjectCompile` runs once the compiler picks the request up
	compileProject = (await import("../../../compiler/project")).compileProject;
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

/**
 * A route promoted while it calls a custom block, behind a middleware, with a
 * suite that has a setup block and a hook; its working copy then says `dev`.
 */
async function sourceProject() {
	const { as, project } = await stack.setup();
	stack.devWorker(project);
	const block = await stack.createBlock(as);
	await stack.setScript(as, "custom-blocks", block.id, "return 'one';");
	await stack.release(as, "custom-blocks", block.id);
	const link = await stack.createBlock(as, "middleware");
	await stack.setScript(as, "custom-blocks", link.id, "return 'link';");
	await stack.release(as, "custom-blocks", link.id);
	const mw = await stack.createMiddleware(as, [link.id]);
	await stack.release(as, "middlewares", mw.id);
	const setup = await stack.createBlock(as, "test");
	await stack.setScript(as, "custom-blocks", setup.id, "return 'setup';");
	await stack.release(as, "custom-blocks", setup.id);

	const route = await stack.createRoute(as, true);
	await stack.callBlock(as, "routes", route, block.name);
	expect(
		(await stack.call(as, "PUT", `/routes/${route}/middlewares`, { before: [mw.id], after: [] })).status,
	).toBe(200);
	const suite = await stack.suite(as, { routeId: route }, { setup: setup.id });
	const caller = (await stack.canvas(as, "routes", route)).blocks.find((b: any) => b.type === block.name);
	await stack.sql`INSERT INTO test_suite_block_hooks (id, suite_id, block_id, on_before)
		VALUES (${Bun.randomUUIDv7()}, ${suite.id}, ${caller.id},
		${JSON.stringify({ kind: "script", value: "t.log('hi')" })}::text::jsonb)`;
	await stack.release(as, "routes", route);
	await stack.setScript(as, "routes", route, "return 'dev';");

	const [row] = await stack.sql`SELECT name FROM routes WHERE id = ${route}`;
	return { as, project, block, link, mw, setup, route, name: row.name as string, suite };
}

const backup = (
	projectId: string,
	{ history = false, mode = "backup" as "backup" | "template", sections }: { history?: boolean; mode?: "backup" | "template"; sections?: string[] } = {},
) =>
	createBackup(
		{ projectId, source: { name: "src", slug: "src" }, mode, sections, options: { includeVersionHistory: history } },
		MODULES,
	);

async function restore(bytes: Uint8Array) {
	const plan = await readBackup(bytes, MODULES);
	const { projectId } = await restoreBackup(plan, (work) =>
		db.transaction(async (tx: any) => {
			const id = Bun.randomUUIDv7();
			await tx.insert(schema.projectsEntity).values({ id, name: id, slug: id });
			await work(tx, id);
			return id;
		}),
	);
	return projectId;
}

const byName = async (table: any, projectId: string, name: string) => {
	const { and, eq } = await import("drizzle-orm");
	const [row] = await db
		.select()
		.from(table)
		.where(and(eq(table.projectId, projectId), eq(table.name, name)));
	return row;
};

const routeVersions = async (id: string) => {
	const { asc, eq } = await import("drizzle-orm");
	return await db
		.select()
		.from(schema.canvasVersionsEntity)
		.where(eq(schema.canvasVersionsEntity.routeId, id))
		.orderBy(asc(schema.canvasVersionsEntity.versionNumber));
};

/** production calls the custom block behind the middleware; development runs the working copy */
async function expectServed(project: string, names: { block: string; mw: string; name: string }) {
	const route = await byName(schema.routesEntity, project, names.name);
	const mw = await byName(schema.middlewaresEntity, project, names.mw);
	await compileProject(project);
	const prod = await stack.routeArtifact(project, route.id, "production");
	expect(prod?.versionId).toBe(route.prodVersionId);
	expect(prod?.source).toContain(names.block);
	expect(prod?.source).not.toContain("'dev'");
	expect(prod?.middlewares).toEqual({ before: [mw.id], after: [] });
	expect((await stack.routeArtifact(project, route.id, "development"))?.source).toContain("('dev')");
	return route;
}

const routeCount = async (name: string) =>
	Number((await stack.sql`SELECT count(*)::int AS n FROM routes WHERE name = ${name}`)[0].n);

describe("routes backup", () => {
	it("restores the working copy, the promoted version, flags, middlewares and suites, and production serves it", async () => {
		const src = await sourceProject();
		const project = await restore((await backup(src.project)).bytes);
		const as = { ...src.as, project };

		const route = await expectServed(project, { block: src.block.name, mw: src.mw.name, name: src.name });
		expect(route.id).not.toBe(src.route);
		const [source] = await stack.sql`SELECT active, dev_active FROM routes WHERE id = ${src.route}`;
		expect([route.active, route.devActive]).toEqual([source.active, source.dev_active]);
		expect([route.active, route.devActive]).toEqual([true, true]);

		// without history only the promoted version travels
		const versions = await routeVersions(route.id);
		expect(versions.map((v: any) => [v.versionNumber, v.id === route.prodVersionId])).toEqual([[1, true]]);
		// v1 is the head too; the working copy moved on since
		expect((await stack.call(as, "GET", `/routes/${route.id}`)).body).toMatchObject({
			headVersionNumber: 1,
			prodVersionNumber: 1,
			uncommitted: true,
		});

		const mw = await byName(schema.middlewaresEntity, project, src.mw.name);
		expect((await stack.call(as, "GET", `/routes/${route.id}/middlewares`)).body.before.map((m: any) => m.id)).toEqual([
			mw.id,
		]);

		// fresh canvas ids, shared by the working copy, the version and the suite's hook
		const canvas = await stack.canvas(as, "routes", route.id);
		const ids = new Set(canvas.blocks.map((b: any) => b.id));
		const sourceCanvas = await stack.canvas(src.as, "routes", src.route);
		expect(sourceCanvas.blocks.some((b: any) => ids.has(b.id))).toBe(false);
		expect(versions[0].snapshot.blocks.every((b: any) => ids.has(b.id))).toBe(true);

		const setup = await byName(schema.customBlocksListEntity, project, src.setup.name);
		const suites = await stack.sql`SELECT s.name, s.setup_block_id, h.block_id FROM test_suites s
			JOIN test_suite_block_hooks h ON h.suite_id = s.id WHERE s.route_id = ${route.id}`;
		expect(suites.length).toBe(1);
		expect(suites[0].name).toBe(src.suite.name);
		expect(suites[0].setup_block_id).toBe(setup.id);
		expect(ids.has(suites[0].block_id)).toBe(true);
	});

	it("keeps every version and the head with version history", async () => {
		const src = await sourceProject();
		await stack.commit(src.as, "routes", src.route, "dev");
		const project = await restore((await backup(src.project, { history: true })).bytes);
		const route = await byName(schema.routesEntity, project, src.name);
		const versions = await routeVersions(route.id);
		expect(versions.map((v: any) => v.versionNumber)).toEqual([1, 2]);
		expect(route.prodVersionId).toBe(versions[0].id);
		expect(route.headVersionId).toBe(versions[1].id);
		expect(versions[1].parentId).toBe(versions[0].id);
	});

	it("refuses a route whose middleware is not in the backup, writing nothing", async () => {
		const src = await sourceProject();
		const restored = restore((await backup(src.project, { sections: ["customBlocks", "routes"] })).bytes);
		await expect(restored).rejects.toThrow(`uses the middleware "${src.mw.name}", which isn't in this backup`);
		expect(await routeCount(src.name)).toBe(1);
	});

	it("refuses a route whose custom block is not in the backup, writing nothing", async () => {
		const { as, project } = await stack.setup();
		const block = await stack.createBlock(as);
		const route = await stack.createRoute(as);
		await stack.callBlock(as, "routes", route, block.name);
		const [row] = await stack.sql`SELECT name FROM routes WHERE id = ${route}`;
		const restored = restore((await backup(project, { sections: ["routes"] })).bytes);
		await expect(restored).rejects.toThrow(`calls the custom block "${block.name}", which isn't in this backup`);
		expect(await routeCount(row.name)).toBe(1);
	});

	it("restores the committed v1 fixture", async () => {
		const file = Bun.file(join(FIXTURES, "routes-v1.tar.gz"));
		if (process.env.WRITE_BACKUP_FIXTURES && !(await file.exists())) {
			const src = await sourceProject();
			await Bun.write(file, (await backup(src.project, { history: true, mode: "template" })).bytes);
			await Bun.write(
				join(FIXTURES, "routes-v1.expected.json"),
				JSON.stringify({ block: src.block.name, mw: src.mw.name, name: src.name, suite: src.suite.name }, null, "\t"),
			);
		}
		const names = await Bun.file(join(FIXTURES, "routes-v1.expected.json")).json();
		// a fresh handle: the one above may have cached the file as missing
		const project = await restore(await Bun.file(file.name!).bytes());

		const route = await expectServed(project, names);
		const [v1] = await routeVersions(route.id);
		expect(route.prodVersionId).toBe(v1.id);
		const [suite] = await stack.sql`SELECT name FROM test_suites WHERE route_id = ${route.id}`;
		expect(suite.name).toBe(names.suite);
	});
});
