import { describe, expect, it } from "bun:test";
import type { HttpRouteParser } from "@fluxify/lib";
import { dispatch, envelopeFromHttp } from "../service";

function fakeCtx(opts: {
	method: string;
	path: string;
	headers?: Record<string, string>;
	query?: Record<string, string>;
}) {
	const headers = opts.headers ?? {};
	return {
		req: {
			method: opts.method,
			path: opts.path,
			header: (name?: string) => (name === undefined ? headers : headers[name]),
			query: () => opts.query ?? {},
			json: async () => ({}),
		},
	} as any;
}

describe("envelopeFromHttp", () => {
	it("maps an HTTP request to a sync route envelope by default", async () => {
		const env = await envelopeFromHttp(
			fakeCtx({ method: "GET", path: "/users", query: { a: "1" } }),
		);
		expect(env.trigger).toEqual({
			kind: "route",
			source: "http",
			reply: "sync",
			id: undefined,
		});
		expect(env.payload.method).toBe("GET");
		expect(env.payload.path).toBe("/users");
		expect(env.payload.query).toEqual({ a: "1" });
		expect(env.payload.body).toBeNull(); // GET has no body
	});

	it("opts into async + correlation id via headers", async () => {
		const env = await envelopeFromHttp(
			fakeCtx({
				method: "GET",
				path: "/jobs",
				headers: { "x-fluxify-reply": "async", "x-fluxify-id": "job-42" },
			}),
		);
		expect(env.trigger.reply).toBe("async");
		expect(env.trigger.id).toBe("job-42");
	});
});

describe("dispatch", () => {
	it("returns 404 without executing when no route matches", async () => {
		const parser = { getRouteId: () => null } as unknown as HttpRouteParser;
		const env = await envelopeFromHttp(
			fakeCtx({ method: "GET", path: "/nope" }),
		);
		const res = await dispatch(env, parser);
		expect(res.status).toBe(404);
		expect(res.data).toEqual({ message: "Route not found" });
	});
});
