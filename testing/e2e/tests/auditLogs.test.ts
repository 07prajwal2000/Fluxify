// Audit logs (#833, Enterprise) end to end: a real admin server, Postgres and
// NATS, the audit consumer running as at boot. Every request here goes over HTTP
// the way a portal, a personal token, an agent, or an MCP client makes it.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { docker } from "@fluxify/adapters/containerTestHelpers";
import {
	type AuditStack,
	admin,
	auditDb,
	mcpTool,
	startAuditStack,
	stopAuditStack,
	type Way,
} from "../src/audit";

let stack: AuditStack;
let db: ReturnType<typeof auditDb>;
let portal: Way;
const uniq = () => Bun.randomUUIDv7().replaceAll("-", "").slice(-10);

beforeAll(async () => {
	stack = await startAuditStack();
	db = auditDb(stack);
	portal = { cookie: stack.tokens.cookie };
}, 300_000);

afterAll(async () => {
	await db?.close().catch(() => {});
	await stopAuditStack();
});

/** a route in `projectId`, made as `way` */
function createRoute(way: Way, projectId: string, name = `route-${uniq()}`) {
	return admin(stack, way, "POST", "/v1/routes", {
		projectId,
		name,
		path: `/${name}`,
		method: "GET",
	});
}

describe("audit logs", () => {
	it("records the sign-in", async () => {
		const [login] = await db.waitFor(
			"action = 'login' AND actor_id = $1",
			1,
			stack.admin.id,
		);
		expect(login).toMatchObject({
			actor_email: stack.admin.email,
			source: "portal",
			project_id: null,
			resource_type: "session",
		});
	});

	it("turns audit logs on for a new project, and records who made it and what changed", async () => {
		const slug = `shop-${uniq()}`;
		const made = await admin(stack, portal, "POST", "/v1/projects", { name: slug, slug });
		expect(made.status).toBe(200);
		const projectId = made.body.id as string;

		const enabled = await db.sql`
			SELECT value FROM project_settings WHERE project_id = ${projectId} AND key = 'auditLogs.enabled'`;
		expect(enabled[0]?.value).toBe("true");

		const [created] = await db.waitFor(
			"resource_type = 'project' AND action = 'create' AND resource_id = $1",
			1,
			projectId,
		);
		expect(created).toMatchObject({
			actor_email: stack.admin.email,
			source: "portal",
			project_id: projectId,
			project_name: slug,
			project_slug: slug,
			status: "success",
		});

		const route = await createRoute(portal, projectId, "orders");
		expect(route.status).toBe(200);
		const renamed = await admin(stack, portal, "PUT", `/v1/routes/${route.body.id}`, {
			name: "orders-v2",
			path: "/orders",
			method: "GET",
			active: false,
		});
		expect(renamed.status).toBe(200);
		const [update] = await db.waitFor(
			"resource_type = 'route' AND action = 'update' AND resource_id = $1",
			1,
			route.body.id,
		);
		expect(update.changed_fields).toContain("name");
		expect(update.changed_fields).not.toContain("path");
		expect(update.project_name).toBe(slug);
	});

	it("labels each way in: portal, personal token, agent run token, OAuth", async () => {
		const label = async (way: Way) => {
			const route = await createRoute(way, stack.projectId);
			expect(route.status).toBe(200);
			return (await db.waitFor("resource_type = 'route' AND resource_id = $1", 1, route.body.id))[0]!;
		};
		const portalRow = await label(portal);
		const patRow = await label({ bearer: stack.tokens.pat });
		const agentRow = await label({ bearer: stack.tokens.agent });
		const oauthRow = await label({ bearer: stack.tokens.oauth });
		expect(portalRow.source).toBe("portal");
		expect(patRow.source).toBe("pat");
		expect(agentRow.source).toBe("agent");
		expect(oauthRow.source).toBe("mcp");
		for (const row of [portalRow, patRow, agentRow, oauthRow]) {
			expect(row.actor_email).toBe(stack.admin.email);
		}
	});

	it("labels a personal token that an MCP tool forwards as mcp", async () => {
		const keyName = `PAT_VIA_MCP_${uniq()}`;
		const saved = await mcpTool(stack, stack.tokens.pat, "save_app_config", {
			projectId: stack.projectId,
			keyName,
			value: "plain",
			description: "",
			isEncrypted: false,
			encodingType: "plaintext",
		});
		expect(saved.ok).toBe(true);
		const id = String(JSON.parse(saved.text).id);
		const [row] = await db.waitFor("resource_type = 'app_config' AND resource_id = $1", 1, id);
		expect(row.source).toBe("mcp");
		// the same token straight at the API stays a personal token
		const direct = await admin(stack, { bearer: stack.tokens.pat }, "POST", `/v1/${stack.projectId}/app-config`, {
			keyName: `PAT_DIRECT_${uniq()}`,
			value: "plain",
			description: "",
			isEncrypted: false,
			encodingType: "plaintext",
		});
		const [directRow] = await db.waitFor("resource_type = 'app_config' AND resource_id = $1", 1, String(direct.body.id));
		expect(directRow.source).toBe("pat");
	});

	it("never stores a secret value, only the names of what changed", async () => {
		const secret = `s3cr3t-${uniq()}`;
		const keyName = `SECRET_${uniq()}`;
		const config = await admin(stack, portal, "POST", `/v1/${stack.projectId}/app-config`, {
			keyName,
			value: secret,
			description: "",
			isEncrypted: true,
			encodingType: "plaintext",
		});
		expect(config.status).toBe(200);
		const integration = await admin(stack, portal, "POST", `/v1/${stack.projectId}/integrations`, {
			name: `redis-${uniq()}`,
			group: "kv",
			variant: "Redis",
			config: { source: "credentials", host: "127.0.0.1", port: 1, password: secret },
		});
		const tested = await admin(stack, portal, "POST", `/v1/${stack.projectId}/integrations/test-connection`, {
			group: "kv",
			variant: "Redis",
			config: { source: "credentials", host: "127.0.0.1", port: 1, password: secret },
		});
		expect(tested.body.success).toBe(false); // nothing listens on port 1
		await db.waitFor("resource_type = 'app_config' AND resource_id = $1", 1, String(config.body.id));
		await db.waitFor("resource_type = 'integration' AND action = 'test' AND project_id = $1", 1, stack.projectId);
		await Bun.sleep(2_500);
		const all = await db.sql`SELECT row_to_json(a)::text AS doc FROM audit_events a`;
		expect(all.length).toBeGreaterThan(0);
		expect(all.some((r: { doc: string }) => r.doc.includes(secret))).toBe(false);
		const [created] = await db.rows("resource_type = 'app_config' AND resource_id = $1", String(config.body.id));
		expect(created.changed_fields).toContain("value");
		expect(integration.status).toBeLessThan(300);
	});

	it("keeps a deleted project's rows, with its name and slug", async () => {
		const slug = `gone-${uniq()}`;
		const made = await admin(stack, portal, "POST", "/v1/projects", { name: slug, slug });
		const projectId = made.body.id as string;
		await createRoute(portal, projectId);
		await db.waitFor("project_id = $1", 2, projectId);

		const deleted = await admin(stack, portal, "DELETE", `/v1/projects/${projectId}`);
		expect(deleted.status).toBe(200);
		const gone = await db.sql`SELECT 1 FROM projects WHERE id = ${projectId}`;
		expect(gone).toHaveLength(0);

		const rows = await db.waitFor("project_id = $1", 3, projectId);
		expect(rows.map((r) => r.action)).toContain("delete");
		expect(rows.every((r) => r.project_name === slug && r.project_slug === slug)).toBe(true);
	});

	it("writes nothing for a project that switched audit logs off", async () => {
		const slug = `quiet-${uniq()}`;
		const made = await admin(stack, portal, "POST", "/v1/projects", { name: slug, slug });
		const projectId = made.body.id as string;
		const off = await admin(stack, portal, "PUT", `/v1/projects/${projectId}/settings/keys`, {
			key: "auditLogs.enabled",
			value: "false",
		});
		expect(off.status).toBe(200);
		// turning it off is the last thing logged
		await db.waitFor("project_id = $1 AND action = 'update'", 1, projectId);
		const before = (await db.rows("project_id = $1", projectId)).length;

		expect((await createRoute(portal, projectId)).status).toBe(200);
		await Bun.sleep(3_000);
		expect((await db.rows("project_id = $1", projectId)).length).toBe(before);
	});

	it("writes nothing once the licence no longer includes audit logs", async () => {
		const community = await admin(stack, portal, "PUT", "/v1/instance-settings/license", {
			edition: "community",
		});
		expect(community.status).toBe(200);
		try {
			const route = await createRoute(portal, stack.projectId);
			expect(route.status).toBe(200);
			await Bun.sleep(3_000);
			expect(await db.rows("resource_id = $1", route.body.id)).toHaveLength(0);
		} finally {
			const restored = await admin(stack, portal, "PUT", "/v1/instance-settings/license", {
				edition: "non_commercial",
				confirmNonCommercial: true,
			});
			expect(restored.status).toBe(200);
		}
	});

	it("records a test suite's create, save, clone, delete and cleared history", async () => {
		const route = await createRoute(portal, stack.projectId);
		const target = `/v1/test-suites/route/${route.body.id}`;
		const made = await admin(stack, portal, "POST", target, { name: "happy", description: "" });
		expect(made.status).toBe(200);
		const suiteId = made.body.id as string;
		const saved = await admin(stack, portal, "PUT", `/v1/test-suites/${suiteId}`, { name: "happier" });
		expect(saved.status).toBe(200);
		const cloned = await admin(stack, portal, "POST", `/v1/test-suites/${suiteId}/clone`, {
			kind: "route",
			targetId: route.body.id,
		});
		expect(cloned.status).toBe(200);
		const cleared = await admin(
			stack,
			portal,
			"DELETE",
			`/v1/${stack.projectId}/test-suites/route/${route.body.id}/runs`,
		);
		expect(cleared.status).toBe(200);
		const gone = await admin(stack, portal, "DELETE", `/v1/test-suites/${suiteId}`);
		expect(gone.status).toBe(200);

		const rows = await db.waitFor("resource_type IN ('test_suite', 'test_run') AND project_id = $1 AND (resource_id = $2 OR resource_id = $3 OR resource_id = $4)", 5, stack.projectId, suiteId, cloned.body.id, route.body.id);
		expect(rows.map((r) => `${r.resource_type}:${r.action}`).sort()).toEqual([
			"test_run:delete",
			"test_suite:copy",
			"test_suite:create",
			"test_suite:delete",
			"test_suite:update",
		]);
		expect(rows.find((r) => r.action === "update")!.changed_fields).toContain("name");
	});

	it("records a middleware's create, save, commit, checkout and delete", async () => {
		const made = await admin(stack, portal, "POST", "/v1/middlewares", {
			projectId: stack.projectId,
			name: `mw-${uniq()}`,
		});
		expect(made.status).toBe(200);
		const id = made.body.id as string;
		const committed = await admin(stack, portal, "POST", `/v1/middlewares/${id}/versions`, { title: "first" });
		expect(committed.status).toBe(200);
		// only a chain change moves the working copy past its last version
		const block = await admin(stack, portal, "POST", "/v1/custom-blocks", {
			projectId: stack.projectId,
			name: `mwblock_${uniq()}`,
			label: "block",
			usage: "middleware",
		});
		expect(block.status).toBe(200);
		const chained = await admin(stack, portal, "PUT", `/v1/middlewares/${id}`, { blocks: [block.body.id] });
		expect(chained.status).toBe(200);
		const back = await admin(stack, portal, "POST", `/v1/middlewares/${id}/versions/${committed.body.id}/checkout`, {});
		expect(back.status).toBe(200);
		expect((await admin(stack, portal, "DELETE", `/v1/middlewares/${id}`)).status).toBe(200);

		await db.waitFor("resource_type = 'middleware' AND resource_id = $1", 1, id);
		await Bun.sleep(3_000);
		const rows = await db.rows("resource_type = 'middleware' AND resource_id = $1", id);
		expect(rows.map((r) => r.action)).toEqual(["create", "commit", "update", "checkout", "delete"]);
	});

	// last: it takes the broker away for good
	it("fails the action, and writes nothing, when the event cannot be published", async () => {
		const name = `lost-${uniq()}`;
		await docker.getContainer(stack.natsContainer).stop({ t: 0 });
		const failed = await createRoute(portal, stack.projectId, name);
		expect(failed.status).toBeGreaterThanOrEqual(500);
		const stored = await db.sql`SELECT 1 FROM routes WHERE name = ${name}`;
		expect(stored).toHaveLength(0);
		expect(await db.rows("changed_fields::text LIKE $1", `%${name}%`)).toHaveLength(0);
	}, 120_000);
});
