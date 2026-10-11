import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { type AdminApi } from "../adminApi";
import { projectTools } from "../projectTools";
import { readTools } from "../tools";
import { touchesProd } from "../../agent/tools";

const all = [...readTools, ...projectTools];
const tool = (name: string) => all.find((t) => t.name === name)!;
const run = (name: string, args: object, rows: Record<string, unknown> = {}) => {
	const calls: [string, any][] = [];
	const api: AdminApi = {
		get: async (path, query) => {
			calls.push([path, query]);
			return rows[path] ?? { items: [], data: [], pagination: {} };
		},
		send: async () => {
			throw new Error("reads never send");
		},
	};
	const result = tool(name).call(api, z.object(tool(name).input).parse(args));
	return { result, calls };
};

describe("reads default to development (#737)", () => {
	it("get_system_logs sends env development unless production is asked for", async () => {
		const a = run("get_system_logs", { projectId: "p" });
		await a.result;
		expect(a.calls[0][1].env).toBe("development");
		const b = run("get_system_logs", { projectId: "p", env: "production" });
		await b.result;
		expect(b.calls[0][1].env).toBe("production");
	});

	it("list_recordings and get_recording read development unless production is asked for", async () => {
		const target = { projectId: "p", kind: "route", targetId: "r" };
		const list = run("list_recordings", target);
		await list.result;
		expect(list.calls[0][1].env).toBe("development");
		const prod = run("list_recordings", { ...target, env: "production" });
		await prod.result;
		expect(prod.calls[0][1].env).toBe("production");

		const path = "/v1/p/recordings/route/r/runs/x";
		const one = run("get_recording", { ...target, runId: "x" }, { [path]: { spans: [] } });
		await one.result.catch(() => {});
		expect(one.calls[0]).toEqual([path, { env: "development" }]);
	});

	const config = { id: 1, keyName: "K", value: "prod-v", devValue: "dev-v", syncDev: false };
	const integration = { id: "i", name: "db", config: { host: "prod" }, devConfig: { host: "dev" }, syncDev: false };

	it("get_app_config hides production's value by default, shows it for env production", async () => {
		const rows = { "/v1/p/app-config/1": config };
		const dev: any = await run("get_app_config", { projectId: "p", appConfigId: 1 }, rows).result;
		expect(dev.devValue).toBe("dev-v");
		expect(dev).not.toHaveProperty("value");
		const prod: any = await run("get_app_config", { projectId: "p", appConfigId: 1, env: "production" }, rows)
			.result;
		expect(prod.value).toBe("prod-v");
	});

	it("get_app_config with 'Same as production' shows that value as the development one", async () => {
		const rows = { "/v1/p/app-config/1": { ...config, devValue: null, syncDev: true } };
		const dev: any = await run("get_app_config", { projectId: "p", appConfigId: 1 }, rows).result;
		expect(dev.devValue).toBe("prod-v");
	});

	it("get_integration hides production's config by default, shows it for env production", async () => {
		const rows = { "/v1/p/integrations/i": integration };
		const dev: any = await run("get_integration", { projectId: "p", integrationId: "i" }, rows).result;
		expect(dev.devConfig).toEqual({ host: "dev" });
		expect(dev).not.toHaveProperty("config");
		const prod: any = await run("get_integration", { projectId: "p", integrationId: "i", env: "production" }, rows)
			.result;
		expect(prod.config).toEqual({ host: "prod" });
	});

	it("every tool that takes env says production is only for when the user asks", () => {
		for (const name of ["get_system_logs", "list_recordings", "get_recording", "get_app_config", "get_integration"])
			expect((tool(name).input.env as { description?: string }).description).toContain("explicitly asks");
	});

	it("touchesProd names what each call does to production", () => {
		expect(touchesProd("get_system_logs", { env: "production" })).toBe("read");
		expect(touchesProd("get_system_logs", {})).toBeUndefined();
		expect(touchesProd("save_app_config", { value: "x" })).toBe("write");
		expect(touchesProd("save_app_config", { devValue: "x", syncDev: true })).toBeUndefined();
		expect(touchesProd("save_integration", { config: {} })).toBe("write");
		expect(touchesProd("save_integration", { devConfig: {} })).toBeUndefined();
		expect(touchesProd("save_trigger", {})).toBe("write");
		expect(touchesProd("save_route", {})).toBeUndefined();
	});
});
