import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Hono } from "hono";
import { z } from "zod";
import { integrationRegistry } from "@fluxify/adapters/integrations";
import * as auditModule from "../../../../modules/audit";
import * as dispatchModule from "../../../../modules/integrationOps/dispatch";
import * as installStatusModule from "../../../../modules/plugins/installStatus";
import { errorHandler } from "../../../../middlewares/errorHandler";
import integrationsRegister from "../register";
import pluginsRegister from "../../plugins/register";
import * as getAllRepo from "../get-all/repository";
import * as getByIdRepo from "../get-by-id/repository";

const PROJECT_ID = "0190a000-0000-7000-8000-000000000001";
const INTEGRATION_ID = "0190a000-0000-7000-8000-000000000002";

const app = new Hono<any>();
app.use("*", async (ctx, next) => {
	ctx.set("user", { id: "u1", isSystemAdmin: true });
	ctx.set("acl", []);
	ctx.set("session", { token: "fake-session-token" });
	await next();
});
app.onError(errorHandler);
integrationsRegister.registerHandler(app);
pluginsRegister.registerHandler(app);

describe("plugin integrations and plugin routes with slashes in router", () => {
	let spies: ReturnType<typeof spyOn>[] = [];

	beforeEach(() => {
		integrationRegistry.register(
			{
				plugin: "demo/toolkit",
				name: "demo/toolkit/smtp",
				label: "SMTP",
				group: "demo/email",
				variant: "smtp",
				schema: z.object({ host: z.string().optional() }),
				create: () => ({}),
			} as any,
			PROJECT_ID,
		);

		spies = [
			spyOn(getAllRepo, "getAllIntegrationsByGroup").mockImplementation(async () => [
				{
					id: INTEGRATION_ID,
					name: "demo-email",
					group: "demo/email",
					variant: "smtp",
					config: { host: "localhost" },
					devConfig: null,
					syncDev: true,
				},
			] as any),
			spyOn(getByIdRepo, "getIntegrationByID").mockImplementation(async () => ({
				id: INTEGRATION_ID,
				name: "demo-email",
				group: "demo/email",
				variant: "smtp",
				config: { host: "localhost" },
				devConfig: null,
				syncDev: true,
			} as any)),
			spyOn(dispatchModule, "runIntegrationOp").mockImplementation(async (op: string) => {
				if (op === "test") return { success: true };
				if (op === "inspect") return { ok: true, details: "inspected" };
				return {};
			}),
			spyOn(installStatusModule, "pluginInstallStatus").mockImplementation(
				async (projectId: string, plugin: string) => ({
					projectId,
					plugin,
					workers: { w1: { state: "ready" } },
				}),
			),
			spyOn(auditModule.audit, "record").mockImplementation(async () => {}),
		];
	});

	afterEach(() => {
		for (const spy of spies) {
			spy.mockRestore();
		}
		integrationRegistry.unregister("demo/email", "smtp", PROJECT_ID);
	});

	it("lists a namespaced plugin group using query parameter ?group=demo/email", async () => {
		const res = await app.request(
			`http://localhost/${PROJECT_ID}/integrations/list?group=demo/email`,
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveLength(1);
		expect(json[0].group).toBe("demo/email");
	});

	it("lists a namespaced plugin group using encoded path param /list/demo%2Femail", async () => {
		const res = await app.request(
			`http://localhost/${PROJECT_ID}/integrations/list/demo%2Femail`,
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveLength(1);
		expect(json[0].group).toBe("demo/email");
	});

	it("lists a namespaced plugin group using unencoded path param /list/demo/email", async () => {
		const res = await app.request(
			`http://localhost/${PROJECT_ID}/integrations/list/demo/email`,
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toHaveLength(1);
		expect(json[0].group).toBe("demo/email");
	});

	it("returns 400 with a clear message for an unknown group", async () => {
		const res = await app.request(
			`http://localhost/${PROJECT_ID}/integrations/list?group=demo/unknown`,
		);
		expect(res.status).toBe(400);
		const json = (await res.json()) as { message?: string };
		expect(json.message).toContain('Unknown integration group "demo/unknown"');
	});

	it("tests connection for a namespaced group and variant returning 200", async () => {
		const res = await app.request(
			`http://localhost/${PROJECT_ID}/integrations/test-connection`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					group: "demo/email",
					variant: "smtp",
					config: { host: "localhost" },
				}),
			},
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ success: true });
	});

	it("inspects a namespaced group and variant returning 200", async () => {
		const res = await app.request(
			`http://localhost/${PROJECT_ID}/integrations/${INTEGRATION_ID}/inspect?env=development`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json).toEqual({ ok: true, details: "inspected" });
	});

	it("plugin routes: decodes %2F within one segment on /plugins/:plugin/install-status", async () => {
		const encoded = encodeURIComponent("demo/toolkit");
		const res = await app.request(
			`http://localhost/plugins/${encoded}/install-status?projectId=${PROJECT_ID}`,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as any;
		expect(json.plugin).toBe("demo/toolkit");
	});

	it("plugin routes: supports two path segments on /plugins/:scope/:name/install-status", async () => {
		const res = await app.request(
			`http://localhost/plugins/demo/toolkit/install-status?projectId=${PROJECT_ID}`,
		);
		expect(res.status).toBe(200);
		const json = (await res.json()) as any;
		expect(json.plugin).toBe("demo/toolkit");
	});
});
