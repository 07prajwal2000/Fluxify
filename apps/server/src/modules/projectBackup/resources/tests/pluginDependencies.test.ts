// Plugin dependencies (#899 part 3) in a project backup, against a real Postgres
// and NATS: plugins are written and restored dependencies first, and a plugin
// whose dependency is not in the backup is warned about, restores, and loads
// blocked, never a crash.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { createStack, type Stack } from "../../../deployments/tests/blockHarness";
import { pluginTgz } from "../../../plugins/sources/tests/tarball";
import { createBackup } from "../../backup";
import { BACKUP_MODULES } from "../../modules";
import { readBackup, restoreBackup } from "../../restore";

const LIB = "acme/lib";
const APP = "acme/app";
const URL_ = "https://github.com/acme/fluxify-plugins";

let stack: Stack;
let db: any;
let schema: typeof import("../../../../db/schema");

beforeAll(async () => {
	stack = await createStack("backupplugindeps");
	db = (await import("../../../../db")).db;
	schema = await import("../../../../db/schema");
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

/** `name` 1.0.0, depending on `deps` (^1.0.0) */
const tgz = (name: string, deps: string[] = []) =>
	pluginTgz({
		"package.json": JSON.stringify({
			name: `@${name}`,
			version: "1.0.0",
			fluxify: { name, url: URL_ },
			peerDependencies: Object.fromEntries(deps.map((d) => [`@${d}`, "^1.0.0"])),
		}),
		"fluxify.json": JSON.stringify({
			name,
			url: URL_,
			sdk: ">=2026.10.0",
			blocks: {},
			...(deps.length && { dependencies: deps.map((d) => ({ name: `@${d}`, plugin: d, range: "^1.0.0" })) }),
		}),
		"dist/blocks/step.js": null,
	} as never);

/** a project holding these plugins, the dependent registered first, all approved */
async function source(plugins: [string, string[]][]) {
	const { project } = await stack.setup();
	const { registerArchive } = await import("../../../plugins/sources/archive");
	for (const [name, deps] of plugins) await registerArchive(project, tgz(name, deps), "upload");
	await stack.sql`UPDATE plugins SET approval = 'approved', permissions = ${JSON.stringify({ integrations: [], appconfig: false })}::text::jsonb WHERE project_id = ${project}`;
	return project;
}

const plan = async (project: string) =>
	readBackup(
		(
			await createBackup(
				{ projectId: project, source: { name: "src", slug: "src" }, mode: "backup", sections: ["plugins"], options: { includeVersionHistory: false } },
				BACKUP_MODULES,
			)
		).bytes,
		BACKUP_MODULES,
	);

const restorePlan = (p: Awaited<ReturnType<typeof readBackup>>) =>
	restoreBackup(p, (work) =>
		db.transaction(async (tx: any) => {
			const id = Bun.randomUUIDv7();
			await tx.insert(schema.projectsEntity).values({ id, name: id, slug: id });
			await work(tx, id);
			return id;
		}),
	);

const names = (p: Awaited<ReturnType<typeof readBackup>>) =>
	(p.sections.find((s) => s.module.name === "plugins")!.data as { plugins: { name: string }[] }).plugins.map((x) => x.name);

describe("plugin dependencies in a backup", () => {
	it("writes a dependency before its dependent, and restores in that order whatever the archive holds", async () => {
		const project = await source([
			[APP, [LIB]],
			[LIB, []],
		]);
		const read = await plan(project);
		expect(names(read)).toEqual([LIB, APP]);

		// an archive written dependents first: an older one, or edited by hand
		(read.sections.find((s) => s.module.name === "plugins")!.data as { plugins: unknown[] }).plugins.reverse();
		expect(names(read)).toEqual([APP, LIB]);
		const { pluginObjects } = await import("../../../../db/natsObjects");
		const put = spyOn(await pluginObjects(), "put");
		try {
			const { projectId, warnings } = await restorePlan(read);
			expect(warnings).toEqual([]);
			expect(put.mock.calls.map(([key]) => [LIB, APP].find((n) => String(key).includes(`/${n}/`)))).toEqual([LIB, APP]);
			const rows = await stack.sql`SELECT name, approval FROM plugins WHERE project_id = ${projectId}`;
			expect(rows.map((r: any) => [r.name, r.approval]).sort()).toEqual([
				[APP, "approved"],
				[LIB, "approved"],
			]);
		} finally {
			put.mockRestore();
		}
	});

	it("warns of a dependency the backup lacks, restores the dependent, and loads it blocked", async () => {
		const project = await source([[APP, [LIB]]]);
		const read = await plan(project);
		expect(read.warnings).toEqual([
			{
				section: "plugins",
				message: expect.stringContaining(`Plugin "${APP}" needs plugin ${LIB} ^1.0.0, which this backup does not hold.`),
			},
		]);
		// the restore tells the user the same again, and goes on
		const { projectId, warnings } = await restorePlan(read);
		expect(warnings).toEqual(read.warnings);
		const { getPlugin } = await import("../../../plugins/service");
		const restored = await getPlugin(projectId, APP);
		expect(restored.approval).toBe("approved");
		expect(restored.blocked?.development).toBe(`it needs plugin ${LIB} ^1.0.0: it is not installed`);
		expect(restored.dependencies.dependsOn).toEqual([
			{ plugin: LIB, package: `@${LIB}`, range: "^1.0.0", installed: null, satisfied: false },
		]);
	});
});
