// Custom blocks and middlewares in a project backup (#1099), against a real
// Postgres and NATS: a project is built and promoted through the HTTP API,
// backed up, restored into a new project, and the real compiler must publish
// the restored promoted versions to production with no promotion of its own.
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

const MODULES = [appConfigModule, integrationsModule, pluginsModule, customBlocksModule, middlewaresModule] as BackupModule[];
const FIXTURES = join(import.meta.dir, "..", "fixtures");

let stack: Stack;
let db: any;
let schema: typeof import("../../../../db/schema");

beforeAll(async () => {
	stack = await createStack("backupblocks");
	db = (await import("../../../../db")).db;
	schema = await import("../../../../db/schema");
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

/** a block that says `one` in production and `two` in development, a block calling it, and a promoted middleware */
async function sourceProject() {
	const { as, project } = await stack.setup();
	const block = await stack.createBlock(as);
	await stack.setScript(as, "custom-blocks", block.id, "return 'one';");
	await stack.release(as, "custom-blocks", block.id);
	await stack.setScript(as, "custom-blocks", block.id, "return 'two';");
	await stack.commit(as, "custom-blocks", block.id, "two");

	const caller = await stack.createBlock(as);
	await stack.callBlock(as, "custom-blocks", caller.id, block.name);

	const link = await stack.createBlock(as, "middleware");
	await stack.setScript(as, "custom-blocks", link.id, "return 'link';");
	await stack.release(as, "custom-blocks", link.id);
	const mw = await stack.createMiddleware(as, [link.id]);
	await stack.release(as, "middlewares", mw.id);
	return { as, project, block, caller, link, mw };
}

const backup = (projectId: string, includeVersionHistory = false, mode: "backup" | "template" = "backup") =>
	createBackup(
		{ projectId, source: { name: "src", slug: "src" }, mode, options: { includeVersionHistory } },
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

const versionsOf = async (column: any, id: string) => {
	const { asc, eq } = await import("drizzle-orm");
	return await db
		.select()
		.from(schema.canvasVersionsEntity)
		.where(eq(column, id))
		.orderBy(asc(schema.canvasVersionsEntity.versionNumber));
};

describe("custom blocks and middlewares backup", () => {
	it("restores the working copy and the promoted version, and production serves it with no promotion", async () => {
		const src = await sourceProject();
		const project = await restore((await backup(src.project)).bytes);
		const as = { ...src.as, project };

		const block = await byName(schema.customBlocksListEntity, project, src.block.name);
		expect(block.id).not.toBe(src.block.id);
		// without history only the promoted version travels, and it is production's
		const versions = await versionsOf(schema.canvasVersionsEntity.customBlockId, block.id);
		expect(versions.map((v: any) => [v.versionNumber, v.id === block.prodVersionId])).toEqual([[1, true]]);
		expect(block.headVersionId).toBeNull();
		expect(block.committedRevision).toBeNull();

		// fresh canvas ids: none of the source's are reused, and edges still join the blocks
		const canvas = await stack.canvas(as, "custom-blocks", block.id);
		const source = await stack.canvas(src.as, "custom-blocks", src.block.id);
		const ids = new Set(canvas.blocks.map((b: any) => b.id));
		expect(source.blocks.some((b: any) => ids.has(b.id))).toBe(false);
		for (const e of canvas.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
		expect(versions[0].snapshot.blocks.every((b: any) => ids.has(b.id))).toBe(true);

		await stack.compileBlock(block.id);
		expect((await stack.blockArtifact(project, block.id, "production"))?.source).toContain("('one')");
		expect((await stack.blockArtifact(project, block.id, "development"))?.source).toContain("('two')");

		const link = await byName(schema.customBlocksListEntity, project, src.link.name);
		const mw = await byName(schema.middlewaresEntity, project, src.mw.name);
		const [prod] = await versionsOf(schema.canvasVersionsEntity.middlewareId, mw.id);
		expect(prod.snapshot.settings.chain).toEqual([link.id]);
		await stack.compileBlock(link.id);
		await stack.compileMiddleware(mw.id);
		expect((await stack.middlewareArtifact(project, mw.id, "production"))?.blocks).toEqual([src.link.name]);
		expect((await stack.call(as, "GET", `/middlewares/${mw.id}`)).body.blocks.map((b: any) => b.id)).toEqual([
			link.id,
		]);

		// a route in the new project finds the restored block by its name
		const route = await stack.createRoute(as, false);
		await stack.callBlock(as, "routes", route, src.block.name);
		await stack.compileRoute(route);
		expect((await stack.routeArtifact(project, route, "development"))?.source).toContain(src.block.name);
	});

	it("keeps every version, the head and the parents with version history", async () => {
		const src = await sourceProject();
		const project = await restore((await backup(src.project, true)).bytes);
		const block = await byName(schema.customBlocksListEntity, project, src.block.name);
		const versions = await versionsOf(schema.canvasVersionsEntity.customBlockId, block.id);
		const source = await versionsOf(schema.canvasVersionsEntity.customBlockId, src.block.id);
		expect(versions.map((v: any) => [v.versionNumber, v.title, v.authorEmail, v.createdAt])).toEqual(
			source.map((v: any) => [v.versionNumber, v.title, v.authorEmail, v.createdAt]),
		);
		expect(block.prodVersionId).toBe(versions[0].id);
		expect(block.headVersionId).toBe(versions[1].id);
		expect(versions[1].parentId).toBe(versions[0].id);
		expect((await stack.call({ ...src.as, project }, "GET", `/custom-blocks/${block.id}`)).body).toMatchObject({
			headVersionNumber: 2,
			prodVersionNumber: 1,
			uncommitted: false,
		});
	});

	it("refuses a middleware whose custom blocks are not in the backup", async () => {
		const src = await sourceProject();
		const plan = await readBackup(
			(
				await createBackup(
					{ projectId: src.project, source: { name: "s", slug: "s" }, mode: "backup", sections: ["middlewares"] },
					MODULES,
				)
			).bytes,
			MODULES,
		);
		const opened = restoreBackup(plan, (work) =>
			db.transaction(async (tx: any) => {
				const id = Bun.randomUUIDv7();
				await tx.insert(schema.projectsEntity).values({ id, name: id, slug: id });
				await work(tx, id);
				return id;
			}),
		);
		await expect(opened).rejects.toThrow(`runs the custom block "${src.link.name}", which isn't in this backup`);
	});

	it("restores the committed v1 fixture", async () => {
		const file = Bun.file(join(FIXTURES, "blocks-middlewares-v1.tar.gz"));
		if (process.env.WRITE_BACKUP_FIXTURES && !(await file.exists())) {
			const src = await sourceProject();
			await Bun.write(file, (await backup(src.project, true, "template")).bytes);
			await Bun.write(
				join(FIXTURES, "blocks-middlewares-v1.expected.json"),
				JSON.stringify({ block: src.block.name, link: src.link.name, caller: src.caller.name, mw: src.mw.name }, null, "\t"),
			);
		}
		const names = await Bun.file(join(FIXTURES, "blocks-middlewares-v1.expected.json")).json();
		// a fresh handle: the one above may have cached the file as missing
		const project = await restore(await Bun.file(file.name!).bytes());

		const block = await byName(schema.customBlocksListEntity, project, names.block);
		const [v1, v2] = await versionsOf(schema.canvasVersionsEntity.customBlockId, block.id);
		expect(block.prodVersionId).toBe(v1.id);
		expect(block.headVersionId).toBe(v2.id);
		expect(JSON.stringify(v1.snapshot.blocks)).toContain("return 'one';");
		expect(await byName(schema.customBlocksListEntity, project, names.caller)).toBeDefined();

		const link = await byName(schema.customBlocksListEntity, project, names.link);
		const mw = await byName(schema.middlewaresEntity, project, names.mw);
		const [prod] = await versionsOf(schema.canvasVersionsEntity.middlewareId, mw.id);
		expect(mw.prodVersionId).toBe(prod.id);
		expect(prod.snapshot.settings.chain).toEqual([link.id]);
		await stack.compileBlock(block.id);
		expect((await stack.blockArtifact(project, block.id, "production"))?.source).toContain("('one')");
	});
});
