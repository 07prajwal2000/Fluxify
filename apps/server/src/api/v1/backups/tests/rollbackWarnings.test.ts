// Rollback warnings that match the project (#1130 follow-up), against a real
// Postgres and NATS. The archive's "this backup doesn't restore X" is dropped
// when the project has an X the rollback keeps; an exact replica warns when it
// removes an app config key a kept route's code mentions, or the last
// integration of a kind a kept plugin needs. Warnings only, never refusals.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Stack } from "../../../../modules/deployments/tests/blockHarness";
import { short } from "../../../../modules/deployments/tests/blockHarness";
import { rollbackStack } from "./rollbackHarness";

let h: Awaited<ReturnType<typeof rollbackStack>>;
let stack: Stack;

beforeAll(async () => {
	h = await rollbackStack("rollbackwarn");
	stack = h.stack;
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

type Note = { message: string; mode: "keep" | "exact"; selected: string[]; kept: string[] };
/** the dialog's rule: what applies with these choices */
const applying = (notes: Note[], mode: Note["mode"], sections: string[]) =>
	notes
		.filter(
			(n) =>
				n.mode === mode &&
				n.selected.every((s) => sections.includes(s)) &&
				n.kept.every((s) => !sections.includes(s)),
		)
		.map((n) => n.message);

const nameOf = async (table: string, id: string) =>
	(await stack.sql.unsafe(`SELECT name FROM ${table} WHERE id = $1`, [id]))[0]?.name as string;

describe("resolved against the project", () => {
	it("keep extras: an integration the archive lacks but the project has is no warning, and resolves", async () => {
		const { as, project } = await stack.setup();
		const pg = Bun.randomUUIDv7();
		await stack.sql`INSERT INTO integrations (id, name, "group", variant, config, project_id)
			VALUES (${pg}, 'pg', 'database', 'PostgreSQL', '{}'::jsonb, ${project})`;
		const route = await stack.createRoute(as);
		await stack.setScript(as, "routes", route, "return 1;");
		// a saved canvas drops keys a block doesn't declare: put the reference in as a db block holds it
		await stack.sql`UPDATE blocks SET data = data || ${JSON.stringify({ connection: pg })}::text::jsonb
			WHERE route_id = ${route} AND type = 'jsrunner'`;
		const bytes = await h.archive(project, { sections: h.ALL.filter((s) => s !== "integrations") });

		const res = await h.inspect(as, bytes);
		expect(res.status).toBe(200);
		const lost = `Route "${await nameOf("routes", route)}" uses integrations this backup doesn't restore`;
		const sections = Object.keys(res.body.sections);
		// the archive alone would warn; the project has "pg", so nothing applies either way
		expect(res.body.rollback.notes.some((n: Note) => n.message.startsWith(lost))).toBe(true);
		expect(res.body.warnings.some((w: { message: string }) => w.message.startsWith(lost))).toBe(false);
		for (const mode of ["keep", "exact"] as const)
			expect(applying(res.body.rollback.notes, mode, sections).some((m) => m.startsWith(lost))).toBe(false);

		const done = await h.rollback(as, bytes, "keep", ["routes"]);
		expect(done.status).toBe(200);
		expect(done.body.warnings.some((w: { message: string }) => w.message.startsWith(lost))).toBe(false);
		const block = (await stack.canvas(as, "routes", route)).blocks.find((b: any) => b.type === "jsrunner");
		expect(block.data.connection).toBe(pg);
	});
});

describe("what an exact replica removes", () => {
	it("warns about a removed app config key a kept route's code mentions, not one nothing mentions", async () => {
		const { as, project } = await stack.setup();
		const bytes = await h.archive(project);
		await stack.sql`INSERT INTO app_config (key_name, value, project_id)
			VALUES ('USED_KEY', 'a', ${project}), ('IDLE_KEY', 'b', ${project})`;
		const route = await stack.createRoute(as);
		await stack.setScript(as, "routes", route, "return ctx.appconfig.get('USED_KEY');");
		const used = `App config key "USED_KEY" will be removed, but route "${await nameOf("routes", route)}" may still read it.`;

		const res = await h.inspect(as, bytes);
		const notes = res.body.rollback.notes as Note[];
		expect(applying(notes, "exact", ["appConfig"])).toContain(used);
		expect(notes.some((n) => n.message.includes("IDLE_KEY"))).toBe(false);
		// the route goes too, or nothing is removed: no warning
		expect(applying(notes, "exact", ["appConfig", "routes"])).not.toContain(used);
		expect(applying(notes, "keep", ["appConfig"])).not.toContain(used);

		// a warning, never a refusal: the rollback goes ahead and says it again
		const done = await h.rollback(as, bytes, "exact", ["appConfig"]);
		expect(done.status).toBe(200);
		expect(done.body.warnings.map((w: { message: string }) => w.message)).toContain(used);
		expect((await stack.sql`SELECT 1 FROM app_config WHERE project_id = ${project}`).length).toBe(0);
	});

	it("warns when it removes the last integration of a kind a kept plugin needs", async () => {
		const { as, project } = await stack.setup();
		const plugin = `acme/kv${short()}`;
		await stack.sql`INSERT INTO plugins (id, project_id, name, version, source, location, integrity, url, sdk_range, manifest, permissions)
			VALUES (${`p${short()}`}, ${project}, ${plugin}, '1.0.0', 'upload', 'x', 'sha256-x', 'https://example.com', '>=1', '{}'::jsonb,
				${JSON.stringify({ integrations: ["kv"], appconfig: false })}::text::jsonb)`;
		// plugins are left out: their bytes are not real here
		const bytes = await h.archive(project, { sections: h.ALL.filter((s) => s !== "plugins") });
		await stack.sql`INSERT INTO integrations (id, name, "group", variant, config, project_id)
			VALUES (${Bun.randomUUIDv7()}, 'cache', 'kv', 'Redis', '{}'::jsonb, ${project})`;
		const message = `Plugin "${plugin}" uses kv integrations, and none will be left.`;

		const res = await h.inspect(as, bytes);
		const notes = res.body.rollback.notes as Note[];
		expect(applying(notes, "exact", ["integrations"])).toContain(message);
		expect(notes.find((n) => n.message === message)).toMatchObject({ removal: true });
		expect(applying(notes, "keep", ["integrations"])).not.toContain(message);
	});
});
