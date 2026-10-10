import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ToolPart } from "../agentMessages";

GlobalRegistrator.register();
const { cleanup, render } = await import("@testing-library/react");
const { ToolBody } = await import("./ToolBody");
const { FieldDiff } = await import("./FieldDiff");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const show = (tool: Partial<ToolPart> & { name: string }) =>
	render(
		<ToolBody
			tool={{ type: "tool", id: "t", input: {}, status: "done", ...tool }}
			asking={false}
		/>,
	);
const items = (v: ReturnType<typeof show>) =>
	[...v.container.querySelectorAll("li")].map((li) => li.textContent);

test("list_advanced_tools and load_tools are bullet lists", () => {
	const list = show({
		name: "list_advanced_tools",
		output: ["delete_route: Delete a route", "list_members: List the members"],
	});
	expect(items(list)).toEqual(["delete_route — Delete a route", "list_members — List the members"]);
	cleanup();
	const load = show({
		name: "load_tools",
		output: { loaded: ["delete_route"], unknown: ["nope"] },
	});
	expect(items(load)).toEqual(["delete_route", "nope"]);
	expect(load.container.textContent).toContain("Not found");
});

test("integration schema details: table names, then columns with types only", () => {
	const names = show({
		name: "get_integration_schema_details",
		output: { tables: ["users", "orders"] },
	});
	expect(items(names)).toEqual(["users", "orders"]);
	cleanup();
	const detail = show({
		name: "get_integration_schema_details",
		output: {
			tables: [
				{
					table: "users",
					columns: [
						{ name: "id", type: "integer", nullable: false, default: "nextval('x')" },
						{ name: "email", type: "text", nullable: true, default: null },
					],
					primaryKey: ["id"],
					foreignKeys: [{ name: "fk_org", definition: "FOREIGN KEY (org) REFERENCES orgs" }],
					indexes: [{ name: "users_pkey", definition: "CREATE UNIQUE INDEX" }],
				},
			],
		},
	});
	expect(items(detail)).toEqual(["id: integer", "email: text"]);
	const text = detail.container.textContent ?? "";
	for (const left of ["nextval", "fk_org", "users_pkey", "primaryKey"])
		expect(text).not.toContain(left);
});

test("integration schema: each config field with its type and whether it is optional", () => {
	const view = show({
		name: "get_integration_schema",
		output: {
			config:
				'{\n\tusername: string;\n\tport: string | number;\n\tuseSSL?: boolean;  // default false\n\tsource: "credentials";\n}\n| {\n\tsource: "url";\n\turl: string;\n}',
			defaults: { host: "", port: 0 },
		},
	});
	expect(items(view)).toEqual([
		"username: string",
		"port: string | number",
		"useSSL: booleanoptional",
		'source: "credentials"',
		'source: "url"',
		"url: string",
	]);
	expect(view.container.textContent).toContain('source = "url"');
	expect(view.container.textContent).not.toContain("defaults");
});

test("a JSON value in a diff is indented in a box that scrolls", () => {
	const view = render(
		<FieldDiff
			changes={[
				{
					field: "body",
					before: { name: "Ann", tags: ["a", "b"] },
					after: '{"name":"Bob","tags":["a","b"]}',
				},
			]}
		/>,
	);
	const box = view.container.querySelector("pre");
	expect(box?.className).toContain("overflow-auto");
	expect(box?.className).toContain("max-h-");
	const text = box?.textContent ?? "";
	expect(text).toContain('"name": "Ann"');
	expect(text).toContain('"name": "Bob"');
	expect(box?.querySelectorAll("div").length).toBeGreaterThan(4);
});
