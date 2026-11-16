// Rolling back in place (#1130), the parts beyond routes, against a real Postgres
// and NATS: an exact replica removes only in the sections chosen, and refuses
// (at preview, and before writing anything) to remove a custom block a route it
// keeps still calls. Integrations and app config keep today's credentials and
// values unless asked. A removed schedule trigger leaves NATS; a restored one is
// registered again.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Stack } from "../../../../modules/deployments/tests/blockHarness";
import { short } from "../../../../modules/deployments/tests/blockHarness";
import { rollbackStack } from "./rollbackHarness";

let h: Awaited<ReturnType<typeof rollbackStack>>;
let stack: Stack;
let republish: typeof import("../../triggers/service").republish;
let removeScheduleEverywhere: typeof import("../../../../modules/schedules/reconciler").removeScheduleEverywhere;
let scheduled: (project: string) => Promise<string[]>;

beforeAll(async () => {
	h = await rollbackStack("rollbackrefs");
	stack = h.stack;
	republish = (await import("../../triggers/service")).republish;
	const reconciler = await import("../../../../modules/schedules/reconciler");
	removeScheduleEverywhere = reconciler.removeScheduleEverywhere;
	await reconciler.ensureSchedulesStream("production");
	await reconciler.ensureSchedulesStream("development");
	const { scheduleSubjects } = await import("@fluxify/common/nats");
	const { natsConnection, natsName } = await import("../../../../db/nats");
	const { SCHEDULES_STREAM, projectScheduleFilter } = await import(
		"../../../../modules/schedules/subjects"
	);
	scheduled = (project) =>
		scheduleSubjects(
			natsConnection(),
			natsName(SCHEDULES_STREAM, "production"),
			natsName(projectScheduleFilter(project), "production"),
		);
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

const nameOf = async (table: string, id: string) =>
	(await stack.sql.unsafe(`SELECT name FROM ${table} WHERE id = $1`, [id]))[0]?.name as string;
const exists = async (table: string, id: string) =>
	(await stack.sql.unsafe(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).length > 0;

describe("exact replica and references", () => {
	it("removes only in the sections chosen, and refuses to break a route it keeps", async () => {
		const { as, project } = await stack.setup();
		const r0 = await stack.createRoute(as);
		const bytes = await h.archive(project);
		// since the backup: a custom block, and a route that calls it
		const block = await stack.createBlock(as);
		await stack.setScript(as, "custom-blocks", block.id, "return 1;");
		await stack.release(as, "custom-blocks", block.id);
		const r1 = await stack.createRoute(as);
		await stack.callBlock(as, "routes", r1, block.name);
		await stack.release(as, "routes", r1);

		// the preview says when it would break, naming both
		const preview = await h.inspect(as, bytes);
		const conflict = preview.body.rollback.conflicts.find((c: any) => c.mode === "exact");
		expect(conflict).toMatchObject({ selected: ["customBlocks"], kept: ["routes"] });
		expect(conflict.message).toContain(`Route "${await nameOf("routes", r1)}"`);
		expect(conflict.message).toContain(block.name);

		// and the rollback refuses it before writing anything, the safety backup included
		const refused = await h.rollback(as, bytes, "exact", ["customBlocks"]);
		expect(refused.status).toBe(400);
		expect(refused.body.message).toContain(block.name);
		expect(await exists("custom_blocks_list", block.id)).toBe(true);
		expect(await h.history(as)).toEqual([]);

		// routes only: r1 goes, the block it called stays, its section wasn't chosen
		expect((await h.rollback(as, bytes, "exact", ["routes"])).status).toBe(200);
		expect(await exists("routes", r1)).toBe(false);
		expect(await exists("routes", r0)).toBe(true);
		expect(await exists("custom_blocks_list", block.id)).toBe(true);

		// nothing uses it now, so it can go
		expect((await h.rollback(as, bytes, "exact", ["customBlocks"])).status).toBe(200);
		expect(await exists("custom_blocks_list", block.id)).toBe(false);
	});

	it("keep extras never refuses for references, and removes nothing", async () => {
		const { as, project } = await stack.setup();
		const bytes = await h.archive(project);
		const block = await stack.createBlock(as);
		const res = await h.rollback(as, bytes, "keep", ["customBlocks"]);
		expect(res.status).toBe(200);
		expect(await exists("custom_blocks_list", block.id)).toBe(true);
	});
});

describe("integrations and app config", () => {
	async function withSecrets() {
		const { as, project } = await stack.setup();
		const pg = Bun.randomUUIDv7();
		await stack.sql`INSERT INTO integrations (id, name, "group", variant, config, project_id)
			VALUES (${pg}, 'pg', 'database', 'PostgreSQL', ${JSON.stringify({ host: "old" })}::text::jsonb, ${project})`;
		await stack.sql`INSERT INTO app_config (key_name, value, project_id) VALUES ('KEY', 'v1', ${project})`;
		const bytes = await h.archive(project, { values: true });
		await stack.sql`UPDATE integrations SET config = ${JSON.stringify({ host: "new" })}::text::jsonb, tags = 'x' WHERE id = ${pg}`;
		await stack.sql`UPDATE app_config SET value = 'v2' WHERE project_id = ${project}`;
		return { as, project, pg, bytes };
	}
	const now = async (project: string, pg: string) => ({
		host: (await stack.sql`SELECT config FROM integrations WHERE id = ${pg}`)[0].config.host,
		value: (await stack.sql`SELECT value FROM app_config WHERE project_id = ${project}`)[0].value,
		integrations: (await stack.sql`SELECT id FROM integrations WHERE project_id = ${project}`).length,
	});
	const sections = ["appConfig", "integrations"];

	it("keep today's credentials and values by default, keeping the ids", async () => {
		const { as, project, pg, bytes } = await withSecrets();
		expect((await h.rollback(as, bytes, "keep", sections)).status).toBe(200);
		expect(await now(project, pg)).toEqual({ host: "new", value: "v2", integrations: 1 });
		expect((await stack.sql`SELECT tags FROM integrations WHERE id = ${pg}`)[0].tags).toBe("");
	});

	it("take the backup's when asked", async () => {
		const { as, project, pg, bytes } = await withSecrets();
		expect((await h.rollback(as, bytes, "keep", sections, true)).status).toBe(200);
		expect(await now(project, pg)).toEqual({ host: "old", value: "v1", integrations: 1 });
	});
});

describe("triggers", () => {
	it("unregisters a removed schedule and registers a restored one", async () => {
		const { as, project } = await stack.setup();
		const workflow = await stack.createWorkflow(as);
		await stack.setScript(as, "workflows", workflow, "return 1;");
		await stack.release(as, "workflows", workflow);
		const group = Bun.randomUUIDv7();
		await stack.sql`INSERT INTO trigger_groups (id, name, project_id, is_default) VALUES (${group}, 'default', ${project}, true)`;
		const schedule = async (name: string) => {
			const [row] = await stack.sql`INSERT INTO triggers (id, name, type, project_id, workflow_id, group_id, schedule, timezone, active, dev_active)
				VALUES (${Bun.randomUUIDv7()}, ${name}, 'schedule', ${project}, ${workflow}, ${group}, '@every 1h', 'UTC', true, true)
				RETURNING *`;
			const trigger = { ...row, projectId: project, workflowId: workflow, groupId: group };
			await republish(trigger);
			return row.id as string;
		};
		const kept = await schedule(`a-${short()}`);
		const bytes = await h.archive(project);
		// since the backup: the backed-up trigger deleted, another one added
		await stack.sql`DELETE FROM triggers WHERE id = ${kept}`;
		await removeScheduleEverywhere(project, kept);
		const added = await schedule(`b-${short()}`);
		expect((await scheduled(project)).some((s) => s.includes(added))).toBe(true);

		const res = await h.rollback(as, bytes, "exact", ["triggers"]);
		expect(res.status).toBe(200);
		expect(res.body.warnings).toEqual([]);
		const [restored] = await stack.sql`SELECT id FROM triggers WHERE project_id = ${project}`;
		const subjects = await scheduled(project);
		expect(subjects.some((s) => s.includes(restored.id))).toBe(true);
		expect(subjects.some((s) => s.includes(added))).toBe(false);
		expect(await exists("triggers", added)).toBe(false);
	});
});
