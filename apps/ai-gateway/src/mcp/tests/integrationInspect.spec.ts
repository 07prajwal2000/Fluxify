import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { ADVANCED, CORE, isRead } from "../../agent/tools";
import { type AdminApi, adminApi } from "../adminApi";
import { writeTools } from "../writeTools";

const tool = (name: string) => writeTools.find((t) => t.name === name)!;
const run = (name: string, args: object, api: AdminApi) =>
	tool(name).call(api, z.object(tool(name).input).parse(args));

function fakeApi() {
	const calls: [string, unknown][] = [];
	const api: AdminApi = {
		get: async (path, query) => {
			calls.push([path, query]);
			return { ok: true };
		},
		send: async () => {
			throw new Error("read-only tools never send");
		},
	};
	return { api, calls };
}

describe("integration inspect tools (#652)", () => {
	it("get_integration_schema_details lists names, or details the given tables", async () => {
		const { api, calls } = fakeApi();
		await run("get_integration_schema_details", { projectId: "p", integrationId: "i" }, api);
		await run("get_integration_schema_details", { projectId: "p", integrationId: "i", tables: ["a", "b"] }, api);
		expect(calls).toEqual([
			["/v1/p/integrations/i/schema", { tables: undefined }],
			["/v1/p/integrations/i/schema", { tables: "a,b" }],
		]);
	});

	it("kv_get reads one key", async () => {
		const { api, calls } = fakeApi();
		await run("kv_get", { projectId: "p", integrationId: "i", key: "users:all" }, api);
		expect(calls).toEqual([["/v1/p/integrations/i/kv", { key: "users:all" }]]);
	});

	it("are creator-only reads, loaded on demand", () => {
		for (const name of ["get_integration_schema_details", "kv_get"]) {
			expect(tool(name).role).toBe("creator");
			expect(tool(name).annotations?.readOnlyHint).toBe(true);
			expect(isRead(name)).toBe(true);
			expect(CORE).not.toContain(name);
			expect(ADVANCED.map((t) => t.name)).toContain(name);
		}
	});

	it("a viewer gets the role error", async () => {
		const denied = adminApi(() => Response.json({}, { status: 403 }), {}, "creator");
		await expect(run("kv_get", { projectId: "p", integrationId: "i", key: "k" }, denied)).rejects.toThrow(
			"You need the Creator role",
		);
	});
});
