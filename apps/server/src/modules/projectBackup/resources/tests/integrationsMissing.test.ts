// Integration references that don't resolve on restore (#1100), against a real
// Postgres and NATS: the integrations section left out of the backup, and an
// archive from before integrations were backed up (the v1, id-based canvas and
// trigger sections). Either way the references are blanked, never left pointing
// at the source project, `plan.warnings` says which, and the restore succeeds.
// Also restores the committed fixture holding every section at its version.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createStack, type Stack } from "../../../deployments/tests/blockHarness";
import { openArchive, writeArchive } from "../../archive";
import { createBackup } from "../../backup";
import { BACKUP_MODULES } from "../../modules";
import { readBackup, restoreBackup } from "../../restore";
import { LOST_INTEGRATION } from "../triggers";
import { referencesOf, type Source, sourceProject } from "./integrationsSource";

const FIXTURES = join(import.meta.dir, "..", "fixtures");

let stack: Stack;
let db: any;
let schema: typeof import("../../../../db/schema");

beforeAll(async () => {
	stack = await createStack("backupintegrationsmissing");
	db = (await import("../../../../db")).db;
	schema = await import("../../../../db/schema");
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

const backup = async (src: Source, sections?: string[]) =>
	(
		await createBackup(
			{
				projectId: src.project,
				source: { name: "src", slug: "src" },
				mode: "template",
				sections,
				options: { includeVersionHistory: true },
			},
			BACKUP_MODULES,
		)
	).bytes;

const restorePlan = (plan: Awaited<ReturnType<typeof readBackup>>) =>
	restoreBackup(plan, (work) =>
		db.transaction(async (tx: any) => {
			const id = Bun.randomUUIDv7();
			await tx.insert(schema.projectsEntity).values({ id, name: id, slug: id });
			await work(tx, id);
			return id;
		}),
	);

const byName = async (table: any, projectId: string) => {
	const { eq } = await import("drizzle-orm");
	const rows = await db.select().from(table).where(eq(table.projectId, projectId));
	return new Map<string, any>(rows.map((r: any) => [r.name, r]));
};

/** an archive as v1 wrote it: the canvas and trigger sections with no integration table */
async function asV1(bytes: Uint8Array) {
	const { manifest, payload } = await openArchive(bytes);
	for (const name of ["customBlocks", "routes", "workflows", "triggers"]) {
		const path = `sections/${name}.json`;
		const { integrations: _, ...section } = JSON.parse(new TextDecoder().decode(payload.get(path)));
		payload.set(path, new TextEncoder().encode(JSON.stringify(section)));
		manifest.sections[name] = 1;
	}
	const { kind: _k, format: _f, integrity: _i, ...head } = manifest;
	return (await writeArchive(head, payload)).bytes;
}

/** blank everywhere, nothing pointing at the source project, and the project still compiles */
async function expectBlank(src: Source, projectId: string) {
	const refs = await referencesOf(stack, projectId);
	for (const old of Object.values(src.ids)) expect(refs).not.toContain(old);

	const route = (await byName(schema.routesEntity, projectId)).get(src.route);
	const canvas = await stack.canvas({ ...src.as, project: projectId }, "routes", route.id);
	expect(canvas.blocks.find((b: any) => b.type === "db_getall").data.connection).toBe("");
	const [suite] = await stack.sql`SELECT integration_overrides FROM test_suites WHERE route_id = ${route.id}`;
	expect(suite.integration_overrides).toEqual([]);
	const triggers = await byName(schema.triggersEntity, projectId);
	expect(triggers.get(src.queue)).toMatchObject({
		integrationId: null,
		active: false,
		devActive: false,
		disabledReason: LOST_INTEGRATION,
	});
	expect(triggers.get(src.plugin).source).toEqual({ store: "", every: 5 });

	const { compileProject } = await import("../../../compiler/project");
	await compileProject(projectId);
	expect(await stack.routeArtifact(projectId, route.id, "development")).not.toBeNull();
	return route;
}

describe("integration references that don't resolve", () => {
	it("are blanked and listed when the integrations section is left out", async () => {
		const src = await sourceProject(stack);
		const all = BACKUP_MODULES.map((m) => m.name).filter((n) => n !== "integrations");
		const plan = await readBackup(await backup(src, all), BACKUP_MODULES);
		const lost = (section: string) => plan.warnings.filter((w) => w.section === section).map((w) => w.message);
		expect(lost("routes")).toEqual([
			expect.stringMatching(
				new RegExp(`^Route "${src.route}" uses integrations this backup doesn't restore: block db_getall_1 \\("pg-main"\\); SSE broker \\("bus"\\); test "${src.routeSuite}" \\("pg-main", "pg-test"\\)\\. They are left blank`),
			),
		]);
		expect(lost("workflows")).toEqual([expect.stringContaining(`Workflow "${src.workflow}" uses integrations`)]);
		expect(lost("customBlocks")).toHaveLength(2);
		expect(lost("triggers")).toEqual([
			expect.stringContaining(`Trigger "${src.queue}" uses integrations this backup doesn't restore: its connector ("bus")`),
			expect.stringContaining(`Trigger "${src.plugin}" uses integrations this backup doesn't restore: its connector ("pg-main")`),
		]);
		expect(lost("projectSettings")).toEqual([expect.stringContaining('settings.ai.agentMcpIntegrations ("docs-mcp")')]);

		const { projectId } = await restorePlan(plan);
		const route = await expectBlank(src, projectId);
		const [config] = await stack.sql`SELECT route_config FROM http_route_config WHERE route_id = ${route.id}`;
		expect(config.route_config.sseBrokerId).toBeNull();
		const [mcp] = await stack.sql`SELECT value FROM project_settings WHERE project_id = ${projectId} AND key = 'settings.ai.agentMcpIntegrations'`;
		expect(mcp.value).toBe("");
	});

	it("restores an archive from before integrations were backed up (v1 sections) through the upgrade steps", async () => {
		const src = await sourceProject(stack);
		const plan = await readBackup(await asV1(await backup(src)), BACKUP_MODULES);
		expect(plan.warnings.find((w) => w.section === "routes")?.message).toContain(
			"block db_getall_1 (an integration from an older backup)",
		);
		await expectBlank(src, (await restorePlan(plan)).projectId);
	});
});

describe("fixtures", () => {
	it("restores the committed fixture: integrations, app config, settings and packages at v1, the rest at v2", async () => {
		const file = Bun.file(join(FIXTURES, "integrations-config-v1.tar.gz"));
		if (process.env.WRITE_BACKUP_FIXTURES && !(await file.exists())) {
			const src = await sourceProject(stack);
			await Bun.write(file, await backup(src));
			const { as: _, project: __, ids: ___, ...names } = src;
			await Bun.write(join(FIXTURES, "integrations-config-v1.expected.json"), JSON.stringify(names, null, "\t"));
		}
		const names = await Bun.file(join(FIXTURES, "integrations-config-v1.expected.json")).json();
		// a fresh handle: the one above may have cached the file as missing
		const plan = await readBackup(await Bun.file(file.name!).bytes(), BACKUP_MODULES);
		expect(plan.manifest.sections).toMatchObject({
			appConfig: 1,
			integrations: 1,
			projectSettings: 1,
			projectDependencies: 1,
			customBlocks: 2,
			routes: 2,
			workflows: 2,
			triggers: 2,
		});
		const { projectId } = await restorePlan(plan);
		const integrations = await byName(schema.integrationsEntity, projectId);
		expect([...integrations.keys()].sort()).toEqual(["bus", "docs-mcp", "pg-main", "pg-test"]);
		const route = (await byName(schema.routesEntity, projectId)).get(names.route);
		const canvas = await stack.canvas({ user: "u", project: projectId }, "routes", route.id);
		expect(canvas.blocks.find((b: any) => b.type === "db_getall").data.connection).toBe(integrations.get("pg-main").id);
		expect((await byName(schema.triggersEntity, projectId)).get(names.queue).integrationId).toBe(integrations.get("bus").id);
		const [deps] = await stack.sql`SELECT version FROM project_dependencies WHERE project_id = ${projectId}`;
		expect(deps.version).toBe(3);
		const keys = await stack.sql`SELECT key_name, value FROM app_config WHERE project_id = ${projectId} ORDER BY key_name`;
		expect(keys.map((k: any) => [k.key_name, k.value])).toEqual([["GREETING", null], ["PG_PASS", null]]);
	});
});
