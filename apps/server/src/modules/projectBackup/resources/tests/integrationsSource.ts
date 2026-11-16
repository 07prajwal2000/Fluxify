// The source project the integration backup tests (#1100) share. A helper, not
// a test file: every resource that can name an integration names one, so a
// restore can be checked for references that still point at this project.
import type { Stack } from "../../../deployments/tests/blockHarness";
import { short } from "../../../deployments/tests/blockHarness";

export type Source = Awaited<ReturnType<typeof sourceProject>>;

const db = (connection: string) => ({ connection, tableName: "items", conditions: [] });

export async function sourceProject(stack: Stack) {
	const { as, project } = await stack.setup();
	const { EncryptionService } = await import("../../../../lib/encryption");
	const { storeValue } = await import("../../../../api/v1/app-config/storage");
	const sealed = (value: unknown) => EncryptionService.encrypt(JSON.stringify(value));

	// app config: an encrypted key with both values, and a plain one development shares
	await stack.sql`INSERT INTO app_config (key_name, description, value, dev_value, sync_dev, project_id, is_encrypted, encoding_type, data_type)
		VALUES ('PG_PASS', 'database password', ${storeValue("prod-pw", true, "base64")}, ${storeValue("dev-pw", true, "base64")}, false, ${project}, true, 'base64', 'string'),
		('GREETING', null, ${storeValue("hello", false, "plaintext")}, null, true, ${project}, false, 'plaintext', 'string')`;

	const integration = async (name: string, group: string, variant: string, config: object, devConfig: object | null, syncDev = false) => {
		const id = Bun.randomUUIDv7();
		await stack.sql`INSERT INTO integrations (id, name, "group", variant, config, dev_config, sync_dev, tags, project_id)
			VALUES (${id}, ${name}, ${group}, ${variant}, ${JSON.stringify(config)}::text::jsonb,
			${devConfig && JSON.stringify(devConfig)}::text::jsonb, ${syncDev}, ${group}, ${project})`;
		return id;
	};
	const pgConfig = { host: "db.example", port: 5432, database: "app", username: "app", source: "credentials" };
	const pg = await integration("pg-main", "database", "PostgreSQL", { ...pgConfig, password: "prod-secret" }, { ...pgConfig, password: "cfg:PG_PASS" });
	const pg2 = await integration("pg-test", "database", "PostgreSQL", { ...pgConfig, password: "cfg:PG_PASS" }, null);
	const nats = await integration("bus", "queue", "NATS", { servers: "nats://bus.example:4222", token: "nats-token" }, null, true);
	const oauth = { v: 1, client: sealed({ client_id: "c1" }), tokens: sealed({ access_token: "a1" }) };
	const mcp = await integration("docs-mcp", "mcp", "http", { url: "https://mcp.example", auth: "oauth", oauth }, null, true);

	const subdomain = `s${short()}`;
	const settings = {
		"settings.ai.agentMcpIntegrations": mcp,
		"settings.telemetry.logsConnectionId": pg2,
		"settings.workflows.triggerConcurrency": "7",
		"settings.routing.subdomain": subdomain,
	};
	for (const [key, value] of Object.entries(settings))
		await stack.sql`INSERT INTO project_settings (id, project_id, key, value) VALUES (${Bun.randomUUIDv7()}, ${project}, ${key}, ${value})`;
	await stack.sql`INSERT INTO project_dependencies (project_id, version, package_json, lockfile)
		VALUES (${project}, 3, '{"dependencies":{"left-pad":"1.3.0"}}', 'lockfile-bytes')`;

	// a flow block and a middleware block whose canvases read the database
	const block = await stack.createBlock(as);
	await stack.setBlock(as, "custom-blocks", block.id, "db_getall", db(pg));
	await stack.commit(as, "custom-blocks", block.id, "v1");
	const mwBlock = await stack.createBlock(as, "middleware");
	await stack.setBlock(as, "custom-blocks", mwBlock.id, "db_getall", db(pg2));
	const middleware = await stack.createMiddleware(as, [mwBlock.id]);

	// a route: a block in the committed version and the working copy, its SSE broker, a test override
	const route = await stack.createRoute(as);
	await stack.setBlock(as, "routes", route, "db_getall", db(pg));
	await stack.commit(as, "routes", route, "v1");
	await stack.sql`INSERT INTO http_route_config (route_id, project_id, route_config)
		VALUES (${route}, ${project}, ${JSON.stringify({ sseBrokerId: nats })}::text::jsonb)
		ON CONFLICT (route_id) DO UPDATE SET route_config = excluded.route_config`;
	const routeSuite = await stack.suite(as, { routeId: route });
	const overrides = JSON.stringify([{ existingId: pg, newId: pg2 }]);
	await stack.sql`UPDATE test_suites SET integration_overrides = ${overrides}::text::jsonb WHERE id = ${routeSuite.id}`;

	const workflow = await stack.createWorkflow(as);
	await stack.setBlock(as, "workflows", workflow, "db_getall", db(pg2));
	await stack.commit(as, "workflows", workflow, "v1");
	const workflowSuite = await stack.suite(as, { workflowId: workflow });
	await stack.sql`UPDATE test_suites SET integration_overrides = ${overrides}::text::jsonb WHERE id = ${workflowSuite.id}`;

	// a queue trigger on the NATS integration, and a plugin trigger naming one in its params
	const group = Bun.randomUUIDv7();
	await stack.sql`INSERT INTO trigger_groups (id, name, project_id, is_default) VALUES (${group}, 'default', ${project}, true)`;
	const [queue, plugin] = [`t-${short()}`, `t-${short()}`];
	await stack.sql`INSERT INTO triggers (id, name, type, project_id, workflow_id, group_id, integration_id, source, active, dev_active)
		VALUES (${Bun.randomUUIDv7()}, ${queue}, 'nats', ${project}, ${workflow}, ${group}, ${nats}, ${JSON.stringify({ subject: "orders" })}::text::jsonb, true, true),
		(${Bun.randomUUIDv7()}, ${plugin}, 'plugin:acme/kit/poll', ${project}, ${workflow}, ${group}, null, ${JSON.stringify({ store: pg, every: 5 })}::text::jsonb, false, false)`;

	const name = async (table: "routes" | "workflows", id: string) =>
		(await stack.sql`SELECT name FROM ${stack.sql(table)} WHERE id = ${id}`)[0].name as string;
	return {
		as,
		project,
		ids: { pg, pg2, nats, mcp },
		subdomain,
		block: block.name,
		mwBlock: mwBlock.name,
		middleware: middleware.name,
		route: await name("routes", route),
		routeSuite: routeSuite.name,
		workflow: await name("workflows", workflow),
		workflowSuite: workflowSuite.name,
		queue,
		plugin,
	};
}

/** every integration reference a restored project holds, read straight from its rows */
export async function referencesOf(stack: Stack, project: string) {
	const sql = stack.sql;
	const owned = (column: string) => sql`${sql(column)} IN (
		SELECT id FROM routes WHERE project_id = ${project} UNION SELECT id FROM workflows WHERE project_id = ${project}
		UNION SELECT id FROM custom_blocks_list WHERE project_id = ${project})`;
	const blocks = await sql`SELECT data FROM blocks WHERE ${owned("route_id")} OR ${owned("workflow_id")} OR ${owned("custom_block_id")}`;
	const versions = await sql`SELECT snapshot FROM canvas_versions WHERE project_id = ${project}`;
	const config = await sql`SELECT route_config FROM http_route_config WHERE project_id = ${project}`;
	const suites = await sql`SELECT integration_overrides FROM test_suites WHERE ${owned("route_id")} OR ${owned("workflow_id")}`;
	const triggers = await sql`SELECT integration_id, source FROM triggers WHERE project_id = ${project}`;
	const settings = await sql`SELECT value FROM project_settings WHERE project_id = ${project}`;
	return JSON.stringify({ blocks, versions, config, suites, triggers, settings });
}
