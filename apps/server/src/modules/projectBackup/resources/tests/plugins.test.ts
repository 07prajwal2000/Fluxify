// Plugins in a project backup (#1101), against a real Postgres and NATS (the
// plugin Object Store and the artifact buckets). An uploaded plugin and a folder
// plugin are backed up with their bytes, then restored with the network and the
// plugins folder gone: both must load, a route's plugin block must compile
// against the restored integration, and a plugin trigger must come up active.
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStack, type Stack } from "../../../deployments/tests/blockHarness";
import { createBackup } from "../../backup";
import { BACKUP_MODULES } from "../../modules";
import { readBackup, restoreBackup } from "../../restore";
import { ECHO, type Source, STORE, sourceProject } from "./pluginsSource";

const FIXTURES = join(import.meta.dir, "..", "fixtures");

let stack: Stack;
let db: any;
let schema: typeof import("../../../../db/schema");
let pluginsDir: string;

beforeAll(async () => {
	stack = await createStack("backupplugins");
	db = (await import("../../../../db")).db;
	schema = await import("../../../../db/schema");
}, 240_000);

afterAll(async () => {
	delete process.env.FLUXIFY_PLUGINS_DIR;
	await stack?.stop();
});

const source = async () => {
	pluginsDir = mkdtempSync(join(tmpdir(), "fx-plugins-"));
	return sourceProject(stack, pluginsDir);
};

type Mode = "backup" | "template";
const backup = async (src: Source, { mode = "backup" as Mode, sections }: { mode?: Mode; sections?: string[] } = {}) =>
	(
		await createBackup(
			{ projectId: src.project, source: { name: "src", slug: "src" }, mode, sections, options: { includeVersionHistory: false } },
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

/** the source's network and plugins folder are gone, as on another instance */
async function offline<T>(work: () => Promise<T>) {
	rmSync(pluginsDir, { recursive: true, force: true });
	delete process.env.FLUXIFY_PLUGINS_DIR;
	const spy = spyOn(globalThis, "fetch").mockImplementation((() => Promise.reject(new Error("offline"))) as never);
	try {
		return await work();
	} finally {
		spy.mockRestore();
	}
}

const pluginRows = async (projectId: string) => {
	const { eq } = await import("drizzle-orm");
	const rows = await db.select().from(schema.pluginsEntity).where(eq(schema.pluginsEntity.projectId, projectId));
	return new Map<string, any>(rows.map((r: any) => [r.name, r]));
};

const named = async (table: "triggers" | "routes" | "integrations", project: string, name: string) =>
	(await stack.sql`SELECT * FROM ${stack.sql(table)} WHERE project_id = ${project} AND name = ${name}`)[0];

const triggerArtifact = async (project: string, id: string) => {
	const { getArtifact } = await import("../../../../db/natsKv");
	const { triggerKey } = await import("../../../compiler/subjects");
	return getArtifact(triggerKey(project, id), "development");
};

/** what a worker does before it imports a plugin: fetch its files, checked against the artifact */
async function loads(row: any) {
	const { fetchPluginFiles } = await import("../../../plugins/install/source");
	const { pluginArtifact } = await import("../../../plugins/service");
	const files = await fetchPluginFiles(pluginArtifact(row));
	return files.has("fluxify.json");
}

describe("plugins backup", () => {
	it("restores both plugins approved, loadable with no network, and compiles a route on the new integration", async () => {
		const src = await source();
		const bytes = await backup(src);
		const { projectId, warnings } = await offline(async () => restorePlan(await readBackup(bytes, BACKUP_MODULES)));
		expect(warnings).toEqual([]);

		const rows = await pluginRows(projectId);
		const approver = src.as.user;
		for (const name of [STORE, ECHO])
			expect(rows.get(name)).toMatchObject({ approval: "approved", approvedBy: approver, devEnabled: true, prodEnabled: true });
		// the folder plugin now lives in the Object Store, like an upload
		expect(rows.get(ECHO)).toMatchObject({ source: "upload", location: `${projectId}/${ECHO}/${rows.get(ECHO).version}.tgz` });
		expect(rows.get(STORE).permissions).toEqual({ integrations: ["kv"], appconfig: false });
		await offline(async () => {
			expect(await loads(rows.get(STORE))).toBe(true);
			expect(await loads(rows.get(ECHO))).toBe(true);
		});

		const { compileProject } = await import("../../../compiler/project");
		await compileProject(projectId);
		const integration = await named("integrations", projectId, "acme-kv");
		const route = await named("routes", projectId, src.route);
		const artifact = await stack.routeArtifact(projectId, route.id, "development");
		expect(artifact?.source).toContain(integration.id);
		expect(artifact?.source).not.toContain(src.integration);

		// its plugin was in place before the trigger was republished
		const trigger = await named("triggers", projectId, src.trigger);
		expect((await triggerArtifact(projectId, trigger.id))?.plugin).toMatchObject({ name: STORE });
	});

	it("refuses a tampered plugin before anything is written", async () => {
		const src = await source();
		const plan = await readBackup(await backup(src), BACKUP_MODULES);
		const files = plan.sections.find((s) => s.module.name === "plugins")!.files;
		const path = Object.keys(files).find((p) => p.startsWith(`${STORE}/`))!;
		files[path] = new Uint8Array([...files[path]!.slice(0, -1), files[path]!.at(-1)! ^ 1]);

		const { pluginObjects } = await import("../../../../db/natsObjects");
		const put = spyOn(await pluginObjects(), "put");
		const before = await stack.sql`SELECT count(*)::int AS n FROM plugins`;
		try {
			await expect(restorePlan(plan)).rejects.toThrow(`Plugin "${STORE}" 2026.10.2001 doesn't match the integrity`);
			expect(put).not.toHaveBeenCalled();
		} finally {
			put.mockRestore();
		}
		expect(await stack.sql`SELECT count(*)::int AS n FROM plugins`).toEqual(before);
	});

	it("restores a plugin trigger switched off, with warnings, when the plugins section is left out", async () => {
		const src = await source();
		const all = BACKUP_MODULES.map((m) => m.name).filter((n) => n !== "plugins");
		const plan = await readBackup(await backup(src, { sections: all }), BACKUP_MODULES);
		expect(plan.warnings).toEqual([
			{ section: "routes", message: expect.stringContaining(`Route "${src.route}" uses plugins this backup doesn't restore: "${STORE}" (block`) },
			{ section: "triggers", message: expect.stringContaining(`Trigger "${src.trigger}" uses plugins this backup doesn't restore: "${STORE}" (its kind)`) },
		]);
		const { projectId } = await restorePlan(plan);
		expect((await pluginRows(projectId)).size).toBe(0);
		const trigger = await named("triggers", projectId, src.trigger);
		expect(await triggerArtifact(projectId, trigger.id)).toBeNull();
	});

	it("restores a template's plugins pending approval", async () => {
		const src = await source();
		const { projectId } = await restorePlan(await readBackup(await backup(src, { mode: "template" }), BACKUP_MODULES));
		for (const row of (await pluginRows(projectId)).values())
			expect(row).toMatchObject({ approval: "pending", approvedBy: null, approvedAt: null, permissions: null });
	});

	it("restores the committed v1 fixture offline", async () => {
		const file = Bun.file(join(FIXTURES, "plugins-v1.tar.gz"));
		if (process.env.WRITE_BACKUP_FIXTURES && !(await file.exists())) {
			const src = await source();
			await Bun.write(file, await backup(src, { mode: "template", sections: ["plugins"] }));
		}
		// a fresh handle: the one above may have cached the file as missing
		const bytes = await Bun.file(file.name!).bytes();
		const { projectId } = await offline(async () => restorePlan(await readBackup(bytes, BACKUP_MODULES)));
		const rows = await pluginRows(projectId);
		expect([...rows.keys()].sort()).toEqual([ECHO, STORE]);
		await offline(async () => {
			for (const row of rows.values()) expect(await loads(row)).toBe(true);
		});
	});
});
