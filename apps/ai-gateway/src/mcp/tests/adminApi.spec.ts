import { describe, expect, it } from "bun:test";
import { adminApi, readableError } from "../adminApi";

describe("readableError", () => {
	it("names the role a 403 needs", () => {
		expect(readableError(403, { message: "Access denied" }, "creator")).toBe(
			"You need the Creator role in this project.",
		);
		expect(readableError(403, null, "project_admin")).toBe(
			"You need the Project Admin role in this project.",
		);
	});

	it("keeps the server's message on 404 and 429", () => {
		expect(readableError(404, { message: "Workflow not found" }, "viewer")).toBe(
			"Not found: Workflow not found Check the id with a list_* tool.",
		);
		expect(readableError(429, { message: "Rate limit exceeded." }, "viewer")).toBe("Rate limit exceeded.");
	});

	it("says to sign in again on 401", () => {
		expect(readableError(401, {}, "viewer")).toContain("sign in again");
	});

	it("lists validation errors on 400", () => {
		const body = { type: "validation", errors: [{ field: "id", message: "Invalid UUID" }] };
		expect(readableError(400, body, "viewer")).toBe("Invalid input: id: Invalid UUID");
	});

	it("falls back to the status for anything else", () => {
		expect(readableError(500, "not json", "viewer")).toBe("Fluxify API error 500.");
	});
});

describe("adminApi", () => {
	it("forwards the caller's credential and builds the query", async () => {
		const seen: { path: string; headers: Record<string, string> }[] = [];
		const { get } = adminApi(
			async (path, init) => {
				seen.push({ path, headers: init.headers as Record<string, string> });
				return Response.json({ ok: true });
			},
			{ authorization: "Bearer flx_test" },
			"viewer",
		);
		expect(await get("/v1/routes/list", { projectId: "p1", page: undefined, perPage: 50 })).toEqual({
			ok: true,
		});
		expect(seen).toEqual([
			{
				path: "/_/admin/api/v1/routes/list?projectId=p1&perPage=50",
				headers: { authorization: "Bearer flx_test", accept: "application/json" },
			},
		]);
	});

	it("throws the readable error on a failed status", async () => {
		const { get } = adminApi(
			async () => Response.json({ message: "Access denied", type: "auth" }, { status: 403 }),
			{},
			"creator",
		);
		await expect(get("/v1/p/app-config/list")).rejects.toThrow("You need the Creator role in this project.");
	});
});

describe("adminApi send", () => {
	it("sends a JSON body as the caller and reads an empty 204", async () => {
		const seen: RequestInit[] = [];
		const { send } = adminApi(
			async (_path, init) => {
				seen.push(init);
				return new Response(null, { status: 204 });
			},
			{ authorization: "Bearer flx_test" },
			"creator",
		);
		expect(await send("POST", "/v1/middlewares", { name: "auth" })).toBeNull();
		expect(seen[0]).toEqual({
			method: "POST",
			body: '{"name":"auth"}',
			headers: {
				authorization: "Bearer flx_test",
				accept: "application/json",
				"content-type": "application/json",
			},
		});
	});
});
