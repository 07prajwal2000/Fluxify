// Workflows, trigger groups and triggers in a project backup (#1098), against a
// real Postgres and NATS: a workflow that calls a custom block and has a suite
// with a setup block, an input loader and a hook is promoted through the HTTP
// API and given a schedule trigger, backed up and restored into a new project.
// The real project compile must publish the restored promoted version to
// production with no promotion of its own, and the restored schedule must be
// registered in NATS, so it fires in the new project.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { createStack, type Stack, short } from "../../../deployments/tests/blockHarness";
import { createBackup } from "../../backup";
import { readBackup, restoreBackup } from "../../restore";
import type { BackupModule } from "../../types";
import { customBlocksModule } from "../customBlocks";
import { triggersModule } from "../triggers";
import { workflowsModule } from "../workflows";

const MODULES = [customBlocksModule, workflowsModule, triggersModule] as BackupModule[];
const FIXTURES = join(import.meta.dir, "..", "fixtures");
type Env = "production" | "development";

let stack: Stack;
let db: any;
let schema: typeof import("../../../../db/schema");
let compileProject: (projectId: string) => Promise<void>;
let workflowArtifact: (project: string, id: string, env: Env) => Promise<any>;
let scheduled: (project: string, env: Env) => Promise<string[]>;

beforeAll(async () => {
	stack = await createStack("backupworkflows");
	db = (await import("../../../../db")).db;
	schema = await import("../../../../db/schema");
	// what `requestProjectCompile` runs once the compiler picks the request up
	compileProject = (await import("../../../compiler/project")).compileProject;
	const { getArtifact } = await import("../../../../db/natsKv");
	const { workflowKey } = await import("../../../compiler/subjects");
	workflowArtifact = (project, id, env) => getArtifact(workflowKey(project, id), env);
	const { scheduleSubjects } = await import("@fluxify/common/nats");
	const { natsConnection, natsName } = await import("../../../../db/nats");
	const { ensureSchedulesStream } = await import("../../../schedules/reconciler");
	const { SCHEDULES_STREAM, projectScheduleFilter } = await import("../../../schedules/subjects");
	await ensureSchedulesStream("production");
	await ensureSchedulesStream("development");
	scheduled = (project, env) =>
		scheduleSubjects(
			natsConnection(),
			natsName(SCHEDULES_STREAM, env),
			natsName(projectScheduleFilter(project), env),
		);
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

async function released(as: { user: string; project: string }, usage: "flow" | "test", script: string) {
	const block = await stack.createBlock(as, usage);
	await stack.setScript(as, "custom-blocks", block.id, script);
	await stack.release(as, "custom-blocks", block.id);
	return block;
}

/**
 * A workflow promoted while it calls a custom block, with a suite that has a
 * setup block, an input loader and a hook; its working copy then says `dev`. A
 * schedule trigger in a group of its own starts it, and an idle one sits in the
 * default group.
 */
async function sourceProject() {
	const { as, project } = await stack.setup();
	stack.devWorker(project);
	const block = await released(as, "flow", "return 'one';");
	const setup = await released(as, "test", "return 'setup';");
	const loader = await released(as, "test", "return { n: 1 };");

	const workflow = await stack.createWorkflow(as);
	await stack.callBlock(as, "workflows", workflow, block.name);
	const suite = await stack.suite(as, { workflowId: workflow }, { setup: setup.id, loader: loader.id });
	const caller = (await stack.canvas(as, "workflows", workflow)).blocks.find((b: any) => b.type === block.name);
	await stack.sql`INSERT INTO test_suite_block_hooks (id, suite_id, block_id, on_before)
		VALUES (${Bun.randomUUIDv7()}, ${suite.id}, ${caller.id},
		${JSON.stringify({ kind: "script", value: "t.log('hi')" })}::text::jsonb)`;
	await stack.release(as, "workflows", workflow);
	await stack.setScript(as, "workflows", workflow, "return 'dev';");

	const group = `g-${short()}`;
	const [def, own] = [Bun.randomUUIDv7(), Bun.randomUUIDv7()];
	await stack.sql`INSERT INTO trigger_groups (id, name, project_id, is_default)
		VALUES (${def}, 'default', ${project}, true), (${own}, ${group}, ${project}, false)`;
	const trigger = `t-${short()}`;
	await stack.sql`INSERT INTO triggers (id, name, type, project_id, workflow_id, group_id, schedule, timezone, active, dev_active, payload)
		VALUES (${Bun.randomUUIDv7()}, ${trigger}, 'schedule', ${project}, ${workflow}, ${own}, '@every 1h', 'UTC', true, true, ${JSON.stringify({ hello: "world" })}::text::jsonb)`;
	const idle = `t-${short()}`;
	await stack.sql`INSERT INTO triggers (id, name, type, project_id, group_id)
		VALUES (${Bun.randomUUIDv7()}, ${idle}, 'internal', ${project}, ${def})`;

	const [row] = await stack.sql`SELECT name FROM workflows WHERE id = ${workflow}`;
	return { as, project, block, setup, loader, workflow, name: row.name as string, suite, group, trigger, idle };
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
	return await restoreBackup(plan, (work) =>
		db.transaction(async (tx: any) => {
			const id = Bun.randomUUIDv7();
			await tx.insert(schema.projectsEntity).values({ id, name: id, slug: id });
			await work(tx, id);
			return id;
		}),
	);
}

const byName = async (table: any, projectId: string, name: string) => {
	const { and, eq } = await import("drizzle-orm");
	const [row] = await db
		.select()
		.from(table)
		.where(and(eq(table.projectId, projectId), eq(table.name, name)));
	return row;
};

const workflowVersions = async (id: string) => {
	const { asc, eq } = await import("drizzle-orm");
	return await db
		.select()
		.from(schema.canvasVersionsEntity)
		.where(eq(schema.canvasVersionsEntity.workflowId, id))
		.orderBy(asc(schema.canvasVersionsEntity.versionNumber));
};

type Source = Awaited<ReturnType<typeof sourceProject>>;
type Names = ReturnType<typeof namesOf>;

/** what a restore is checked by: names only, which the fixture keeps too */
const namesOf = (src: Source) => ({
	block: src.block.name,
	name: src.name,
	trigger: src.trigger,
	group: src.group,
	idle: src.idle,
	setup: src.setup.name,
	loader: src.loader.name,
	suite: src.suite.name,
});

/** production runs the promoted version, development the working copy, and the schedule is live in both */
async function expectLive(project: string, names: Names) {
	const workflow = await byName(schema.workflowsEntity, project, names.name);
	await compileProject(project);
	const prod = await workflowArtifact(project, workflow.id, "production");
	expect(prod?.versionId).toBe(workflow.prodVersionId);
	expect(prod?.source).toContain(names.block);
	expect(prod?.source).not.toContain("'dev'");
	expect((await workflowArtifact(project, workflow.id, "development"))?.source).toContain("('dev')");

	const trigger = await byName(schema.triggersEntity, project, names.trigger);
	expect(trigger.workflowId).toBe(workflow.id);
	expect(trigger.payload).toEqual({ hello: "world" });
	const group = await byName(schema.triggerGroupsEntity, project, names.group);
	expect(trigger.groupId).toBe(group.id);
	for (const env of ["production", "development"] as const)
		expect((await scheduled(project, env)).some((s) => s.endsWith(trigger.id))).toBe(true);

	const idle = await byName(schema.triggersEntity, project, names.idle);
	const def = await byName(schema.triggerGroupsEntity, project, "default");
	expect([idle.workflowId, idle.groupId, def.isDefault]).toEqual([null, def.id, true]);

	const setup = await byName(schema.customBlocksListEntity, project, names.setup);
	const loader = await byName(schema.customBlocksListEntity, project, names.loader);
	const [suite] = await stack.sql`SELECT name, setup_block_id, input FROM test_suites WHERE workflow_id = ${workflow.id}`;
	expect(suite.name).toBe(names.suite);
	expect(suite.setup_block_id).toBe(setup.id);
	expect(suite.input).toMatchObject({ source: "loader", mode: "single", loaderBlockId: loader.id });
	return workflow;
}

const count = async (table: "triggers" | "trigger_groups" | "workflows", name: string) => {
	const rows =
		table === "triggers"
			? await stack.sql`SELECT count(*)::int AS n FROM triggers WHERE name = ${name}`
			: table === "trigger_groups"
				? await stack.sql`SELECT count(*)::int AS n FROM trigger_groups WHERE name = ${name}`
				: await stack.sql`SELECT count(*)::int AS n FROM workflows WHERE name = ${name}`;
	return Number(rows[0].n);
};

/** every trigger schedule on the broker, across projects */
const allSchedules = async () => (await scheduled("*", "production")).length + (await scheduled("*", "development")).length;

describe("workflows and triggers backup", () => {
	it("restores the workflow's dev and prod state, its suite and its triggers, which then fire", async () => {
		const src = await sourceProject();
		const project = await restore((await backup(src.project)).bytes);
		const workflow = await expectLive(project, namesOf(src));
		expect(workflow.id).not.toBe(src.workflow);
		expect([workflow.active, workflow.devActive]).toEqual([true, true]);

		// without history only the promoted version travels; it is the head too
		const versions = await workflowVersions(workflow.id);
		expect(versions.map((v: any) => [v.versionNumber, v.id === workflow.prodVersionId])).toEqual([[1, true]]);
		expect(workflow.headVersionId).toBe(versions[0].id);

		// fresh canvas ids, shared by the working copy, the version and the suite's hook
		const canvas = await stack.canvas({ ...src.as, project }, "workflows", workflow.id);
		const ids = new Set(canvas.blocks.map((b: any) => b.id));
		const sourceCanvas = await stack.canvas(src.as, "workflows", src.workflow);
		expect(sourceCanvas.blocks.some((b: any) => ids.has(b.id))).toBe(false);
		expect(versions[0].snapshot.blocks.every((b: any) => ids.has(b.id))).toBe(true);
		const [hook] = await stack.sql`SELECT h.block_id FROM test_suite_block_hooks h
			JOIN test_suites s ON s.id = h.suite_id WHERE s.workflow_id = ${workflow.id}`;
		expect(ids.has(hook.block_id)).toBe(true);
	});

	it("keeps every version and the head with version history", async () => {
		const src = await sourceProject();
		await stack.commit(src.as, "workflows", src.workflow, "dev");
		const project = await restore((await backup(src.project, { history: true })).bytes);
		const workflow = await byName(schema.workflowsEntity, project, src.name);
		const versions = await workflowVersions(workflow.id);
		expect(versions.map((v: any) => v.versionNumber)).toEqual([1, 2]);
		expect(workflow.prodVersionId).toBe(versions[0].id);
		expect(workflow.headVersionId).toBe(versions[1].id);
	});

	it("refuses a trigger whose workflow is not in the backup, writing nothing and scheduling nothing", async () => {
		const src = await sourceProject();
		const before = await allSchedules();
		const restored = restore((await backup(src.project, { sections: ["customBlocks", "triggers"] })).bytes);
		await expect(restored).rejects.toThrow(`starts the workflow "${src.name}", which isn't in this backup`);
		expect(await count("triggers", src.trigger)).toBe(1);
		expect(await count("trigger_groups", src.group)).toBe(1);
		expect(await allSchedules()).toBe(before);
	});

	it("refuses a workflow whose custom block is not in the backup, writing nothing", async () => {
		const { as, project } = await stack.setup();
		const block = await stack.createBlock(as);
		const workflow = await stack.createWorkflow(as);
		await stack.callBlock(as, "workflows", workflow, block.name);
		const [row] = await stack.sql`SELECT name FROM workflows WHERE id = ${workflow}`;
		const restored = restore((await backup(project, { sections: ["workflows"] })).bytes);
		await expect(restored).rejects.toThrow(`calls the custom block "${block.name}", which isn't in this backup`);
		expect(await count("workflows", row.name)).toBe(1);
	});

	it("restores the committed v1 fixture", async () => {
		const file = Bun.file(join(FIXTURES, "workflows-triggers-v1.tar.gz"));
		if (process.env.WRITE_BACKUP_FIXTURES && !(await file.exists())) {
			const src = await sourceProject();
			await Bun.write(file, (await backup(src.project, { history: true, mode: "template" })).bytes);
			await Bun.write(
				join(FIXTURES, "workflows-triggers-v1.expected.json"),
				JSON.stringify(namesOf(src), null, "\t"),
			);
		}
		const names = await Bun.file(join(FIXTURES, "workflows-triggers-v1.expected.json")).json();
		// a fresh handle: the one above may have cached the file as missing
		const project = await restore(await Bun.file(file.name!).bytes());
		const workflow = await expectLive(project, names);
		const [v1] = await workflowVersions(workflow.id);
		expect(workflow.prodVersionId).toBe(v1.id);
	});
});
