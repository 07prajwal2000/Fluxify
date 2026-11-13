// Integrations, app config, project settings and npm packages in a project
// backup (#1100), against a real Postgres and NATS. A project whose blocks,
// middleware block, route (SSE broker, test override), workflow, queue trigger,
// plugin trigger and settings all name integrations is restored next to itself,
// on the same instance: every reference must point at the new project's
// integrations, none at the source's.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createStack, type Stack } from "../../../deployments/tests/blockHarness";
import { createBackup } from "../../backup";
import { BACKUP_MODULES } from "../../modules";
import { readBackup, restoreBackup } from "../../restore";
import { referencesOf, type Source, sourceProject } from "./integrationsSource";

let stack: Stack;
let db: any;
let schema: typeof import("../../../../db/schema");
let EncryptionService: typeof import("../../../../lib/encryption").EncryptionService;

beforeAll(async () => {
	stack = await createStack("backupintegrations");
	db = (await import("../../../../db")).db;
	schema = await import("../../../../db/schema");
	EncryptionService = (await import("../../../../lib/encryption")).EncryptionService;
}, 240_000);

afterAll(async () => {
	await stack?.stop();
});

type Options = { mode?: "backup" | "template"; values?: boolean };
const backup = (src: Source, { mode = "backup", values = true }: Options = {}) =>
	createBackup(
		{
			projectId: src.project,
			source: { name: "src", slug: "src" },
			mode,
			options: { includeVersionHistory: true, includeAppConfigValues: values },
		},
		BACKUP_MODULES,
	);

const restore = async (bytes: Uint8Array) =>
	restoreBackup(await readBackup(bytes, BACKUP_MODULES), (work) =>
		db.transaction(async (tx: any) => {
			const id = Bun.randomUUIDv7();
			await tx.insert(schema.projectsEntity).values({ id, name: id, slug: id });
			await work(tx, id);
			return id;
		}),
	);

const rows = async (table: any, projectId: string) => {
	const { eq } = await import("drizzle-orm");
	return await db.select().from(table).where(eq(table.projectId, projectId));
};
const byName = async (table: any, projectId: string) =>
	new Map<string, any>((await rows(table, projectId)).map((r: any) => [r.name ?? r.keyName, r]));

describe("integration references", () => {
	it("point at the restored project's integrations, never the source's", async () => {
		const src = await sourceProject(stack);
		const { projectId, warnings } = await restore((await backup(src)).bytes);
		const integrations = await byName(schema.integrationsEntity, projectId);
		const id = (name: string) => integrations.get(name).id as string;

		const refs = await referencesOf(stack, projectId);
		for (const old of Object.values(src.ids)) expect(refs).not.toContain(old);
		for (const name of ["pg-main", "pg-test", "bus", "docs-mcp"]) expect(refs).toContain(id(name));

		const route = (await byName(schema.routesEntity, projectId)).get(src.route);
		const canvas = await stack.canvas({ ...src.as, project: projectId }, "routes", route.id);
		expect(canvas.blocks.find((b: any) => b.type === "db_getall").data.connection).toBe(id("pg-main"));
		const [config] = await stack.sql`SELECT route_config FROM http_route_config WHERE route_id = ${route.id}`;
		expect(config.route_config.sseBrokerId).toBe(id("bus"));
		const [suite] = await stack.sql`SELECT integration_overrides FROM test_suites WHERE route_id = ${route.id}`;
		expect(suite.integration_overrides).toEqual([{ existingId: id("pg-main"), newId: id("pg-test") }]);

		const triggers = await byName(schema.triggersEntity, projectId);
		expect(triggers.get(src.queue)).toMatchObject({ integrationId: id("bus"), active: true });
		expect(triggers.get(src.plugin).source).toEqual({ store: id("pg-main"), every: 5 });
		const middleware = (await byName(schema.middlewaresEntity, projectId)).get(src.middleware);
		expect(middleware).toBeDefined();

		const settings = Object.fromEntries((await rows(schema.projectSettingsEntity, projectId)).map((s: any) => [s.key, s.value]));
		expect(settings["settings.ai.agentMcpIntegrations"]).toBe(id("docs-mcp"));
		expect(settings["settings.telemetry.logsConnectionId"]).toBe(id("pg-test"));
		expect(settings["settings.workflows.triggerConcurrency"]).toBe("7");
		// the source still holds its subdomain on this instance
		expect(settings["settings.routing.subdomain"]).toBeUndefined();
		expect(warnings).toEqual([
			// the source never installed the plugin its plugin trigger names
			{ section: "triggers", message: expect.stringContaining(`Trigger "${src.plugin}" uses plugins this backup doesn't restore`) },
			{ section: "projectSettings", message: expect.stringContaining(`The subdomain "${src.subdomain}" is already used`) },
		]);

		const [deps] = await rows(schema.projectDependenciesEntity, projectId);
		expect(deps).toMatchObject({ version: 3, lockfile: "lockfile-bytes" });
	});
});

describe("secrets", () => {
	it("a backup restores every secret byte for byte, in both environments", async () => {
		const src = await sourceProject(stack);
		const { projectId } = await restore((await backup(src)).bytes);
		const pick = ({ config, devConfig, syncDev, group, variant }: any) => ({ config, devConfig, syncDev, group, variant });
		const before = await byName(schema.integrationsEntity, src.project);
		const after = await byName(schema.integrationsEntity, projectId);
		for (const [name, row] of before) expect(pick(after.get(name))).toEqual(pick(row));
		const tokens = after.get("docs-mcp").config.oauth.tokens;
		expect(JSON.parse(EncryptionService.decrypt(tokens))).toEqual({ access_token: "a1" });

		const keys = (r: any) => ({ v: r.value, d: r.devValue, s: r.syncDev, e: r.isEncrypted, t: r.encodingType });
		const cfgBefore = await byName(schema.appConfigEntity, src.project);
		const cfgAfter = await byName(schema.appConfigEntity, projectId);
		for (const [key, row] of cfgBefore) expect(keys(cfgAfter.get(key))).toEqual(keys(row));
		const { loadAppConfigFor } = await import("../../../../loaders/appconfigLoader");
		expect((await loadAppConfigFor("production", projectId)).config[projectId]).toEqual({ PG_PASS: "prod-pw", GREETING: "hello" });
		expect((await loadAppConfigFor("development", projectId)).config[projectId]).toEqual({ PG_PASS: "dev-pw", GREETING: "hello" });
	});

	it("without app config values a backup keeps only the keys", async () => {
		const src = await sourceProject(stack);
		const { projectId } = await restore((await backup(src, { values: false })).bytes);
		const cfg = await byName(schema.appConfigEntity, projectId);
		expect(cfg.get("PG_PASS")).toMatchObject({
			description: "database password",
			isEncrypted: true,
			encodingType: "base64",
			dataType: "string",
			value: null,
			devValue: null,
			syncDev: false,
		});
		expect(cfg.get("GREETING")).toMatchObject({ value: null, devValue: null, syncDev: false });
		// integrations are not app config: a backup still keeps them
		expect((await byName(schema.integrationsEntity, projectId)).get("pg-main").config.password).toBe("prod-secret");
	});

	it("a template blanks every secret, and the project still compiles and lists what is missing", async () => {
		const src = await sourceProject(stack);
		const { projectId } = await restore((await backup(src, { mode: "template" })).bytes);
		const integrations = await byName(schema.integrationsEntity, projectId);
		expect(integrations.get("pg-main")).toMatchObject({
			config: { host: "", port: 5432, database: "", username: "", source: "", password: "" },
			devConfig: null,
			syncDev: false,
		});
		// an app config reference is no secret, and its key travels anyway
		expect(integrations.get("pg-test").config.password).toBe("cfg:PG_PASS");
		expect(integrations.get("bus").config).toEqual({ servers: "", token: "" });
		expect(integrations.get("docs-mcp").config).toEqual({ url: "", auth: "" });
		for (const row of (await byName(schema.appConfigEntity, projectId)).values())
			expect([row.value, row.devValue]).toEqual([null, null]);

		const { compileProject } = await import("../../../compiler/project");
		await compileProject(projectId);
		const route = (await byName(schema.routesEntity, projectId)).get(src.route);
		expect(await stack.routeArtifact(projectId, route.id, "development")).not.toBeNull();
		const { loadAppConfigFor } = await import("../../../../loaders/appconfigLoader");
		expect((await loadAppConfigFor("development", projectId)).missing[projectId]?.sort()).toEqual(["GREETING", "PG_PASS"]);
	});
});
