import { describe, expect, it } from "bun:test";
import type { HttpRouteParser } from "@fluxify/lib";
import { setBlocksExecutor } from "../executor";
import { dispatch, envelopeFromHttp, executeRouteInternal } from "../service";

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

	it("uses a supplied artifact-time validator before creating route resources", async () => {
		let validations = 0;
		const parser = {
			getRouteId: () => ({
				id: "route-1",
				projectId: "project-1",
				projectName: "Project",
				bodySchema: { dataType: "str" },
			}),
		} as unknown as HttpRouteParser;
		const env = {
			trigger: { kind: "route", source: "http", reply: "sync" as const },
			payload: {
				method: "POST",
				path: "/jobs",
				headers: {},
				query: {},
				body: "input",
			},
		};
		const cachedValidator = {
			validate: async () => {
				validations++;
				return {
					success: false,
					errors: [{ path: "", property: "", errors: ["expected failure"] }],
				};
			},
		};

		const res = await dispatch(env, parser, undefined, undefined, () => ({
			body: cachedValidator as any,
		}));

		expect(validations).toBe(1);
		expect(res.status).toBe(400);
		expect(res.data).toEqual({
			message: "Body validation failed",
			errors: [{ path: "", property: "", errors: ["expected failure"] }],
		});
	});

	it("reuses the HTTP client and normalizes headers once per execution", async () => {
		let firstClient: unknown;
		let executions = 0;
		setBlocksExecutor(async (_target, context) => {
			executions++;
			expect(context.vars.getHeader("x-request-id")).toBe("request-42");
			expect(context.vars.getHeader("X-REQUEST-ID")).toBe("request-42");
			if (firstClient) expect(context.httpClient).toBe(firstClient);
			else firstClient = context.httpClient;
			return { successful: true, output: { body: "ok" } } as any;
		});

		const route = {
			id: "route-1",
			projectId: "project-1",
			projectName: "Project",
		};
		const request = {
			method: "GET",
			path: "/jobs",
			headers: { "X-Request-Id": "request-42" },
			query: {},
			body: null,
			params: {},
		};

		await executeRouteInternal(route, request);
		await executeRouteInternal(route, request);
		expect(executions).toBe(2);
	});
});
