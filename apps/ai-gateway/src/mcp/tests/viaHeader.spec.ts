import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { httpAdminFetch, VIA_HEADER } from "../adminApi";

afterEach(() => spyOn(globalThis, "fetch").mockRestore());

describe("httpAdminFetch", () => {
	it("labels every call it sends to the admin API as coming through MCP", async () => {
		const sent = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
		await httpAdminFetch("/_/admin/api/v1/routes", {
			method: "POST",
			headers: { authorization: "Bearer flx_test", "content-type": "application/json" },
		});
		const init = sent.mock.calls[0]![1] as RequestInit;
		expect(init.headers).toEqual({
			authorization: "Bearer flx_test",
			"content-type": "application/json",
			[VIA_HEADER]: "mcp",
		});
		expect(init.method).toBe("POST");
	});

	it("overrides a via header the caller tried to set", async () => {
		const sent = spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
		await httpAdminFetch("/x", { headers: { [VIA_HEADER]: "portal" } });
		expect((sent.mock.calls[0]![1] as RequestInit).headers).toEqual({ [VIA_HEADER]: "mcp" });
	});
});
