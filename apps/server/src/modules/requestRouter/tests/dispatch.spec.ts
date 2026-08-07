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

/** a real Request, so the body reader sees real headers and a real stream */
function postCtx(body: string, contentType: string) {
	const raw = new Request("http://localhost/jobs", {
		method: "POST",
		body,
		headers: { "content-type": contentType },
	});
	return {
		req: {
			method: "POST",
			path: "/jobs",
			header: (name?: string) =>
				name === undefined
					? Object.fromEntries(raw.headers.entries())
					: (raw.headers.get(name) ?? undefined),
			query: () => ({}),
			raw,
		},
	} as any;
}

function multipartCtx(fields: Record<string, string | File>) {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const raw = new Request("http://localhost/jobs", {
		method: "POST",
		body: form,
	});
	return {
		req: {
			method: "POST",
			path: "/jobs",
			header: (name?: string) =>
				name === undefined
					? Object.fromEntries(raw.headers.entries())
					: (raw.headers.get(name) ?? undefined),
			query: () => ({}),
			raw,
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

	it("rejects a body the matched route does not accept", async () => {
		const parser = {
			getRouteId: () => ({
				id: "route-1",
				projectId: "project-1",
				projectName: "Project",
				acceptedContentTypes: ["multipart/form-data"],
			}),
		} as unknown as HttpRouteParser;
		const env = await envelopeFromHttp(
			postCtx('{"a":1}', "application/json"),
		);

		const res = await dispatch(env, parser);

		expect(res.status).toBe(415);
		expect((res.data as { message: string }).message).toContain(
			"multipart/form-data",
		);
	});

	it("parses the body only after the route matched, and hands it to the graph", async () => {
		let seen: unknown;
		setBlocksExecutor(async (_target, context) => {
			seen = context.requestBody;
			return { successful: true, output: { body: "ok" } } as any;
		});
		const parser = {
			getRouteId: () => ({
				id: "route-1",
				projectId: "project-1",
				projectName: "Project",
				acceptedContentTypes: ["application/x-www-form-urlencoded"],
			}),
		} as unknown as HttpRouteParser;
		const env = await envelopeFromHttp(
			postCtx("name=Alice", "application/x-www-form-urlencoded"),
		);

		await dispatch(env, parser);

		expect(seen).toEqual({ name: "Alice" });
	});

	it("falls back to JSON only when a route carries no content type config", async () => {
		const parser = {
			getRouteId: () => ({
				id: "route-1",
				projectId: "project-1",
				projectName: "Project",
			}),
		} as unknown as HttpRouteParser;
		const env = await envelopeFromHttp(postCtx("plain", "text/plain"));

		const res = await dispatch(env, parser);

		expect(res.status).toBe(415);
	});

	it("validates an uploaded file against the route's body schema", async () => {
		// the seam: what the multipart parser produces must be what the schema
		// parser's `file` type accepts, size rules included
		const bodySchema = {
			dataType: "object",
			properties: [
				{
					key: "avatar",
					dataType: "file",
					rules: [
						{ type: "maxSize", value: 8 },
						{ type: "mimeTypes", value: "image/png" },
					],
				},
				{ key: "title", dataType: "str" },
			],
		};
		const parser = {
			getRouteId: () => ({
				id: "route-1",
				projectId: "project-1",
				projectName: "Project",
				acceptedContentTypes: ["multipart/form-data"],
				bodySchema,
			}),
		} as unknown as HttpRouteParser;

		let seen: any;
		setBlocksExecutor(async (_target, context) => {
			seen = context.requestBody;
			return { successful: true, output: { body: "ok" } } as any;
		});

		const accepted = await dispatch(
			await envelopeFromHttp(
				multipartCtx({
					title: "avatar",
					avatar: new File(["12345"], "a.png", { type: "image/png" }),
				}),
			),
			parser,
		);
		expect(accepted.status).toBe(200);
		expect(seen.avatar).toBeInstanceOf(File);
		expect(seen.title).toBe("avatar");

		const tooBig = await dispatch(
			await envelopeFromHttp(
				multipartCtx({
					title: "avatar",
					avatar: new File(["x".repeat(64)], "a.png", { type: "image/png" }),
				}),
			),
			parser,
		);
		expect(tooBig.status).toBe(400);
		expect((tooBig.data as any).message).toBe("Body validation failed");
		expect((tooBig.data as any).errors[0].property).toBe("avatar");

		const wrongType = await dispatch(
			await envelopeFromHttp(
				multipartCtx({
					title: "avatar",
					avatar: new File(["12345"], "a.pdf", { type: "application/pdf" }),
				}),
			),
			parser,
		);
		expect(wrongType.status).toBe(400);
	});

	it("validates a urlencoded body against the route's body schema", async () => {
		// every value a form sends is text, so a numeric field must be coerced
		// by the schema author, not silently accepted
		const parser = {
			getRouteId: () => ({
				id: "route-1",
				projectId: "project-1",
				projectName: "Project",
				acceptedContentTypes: ["application/x-www-form-urlencoded"],
				bodySchema: {
					dataType: "object",
					properties: [
						{ key: "name", dataType: "str", rules: [{ type: "minLength", value: 2 }] },
					],
				},
			}),
		} as unknown as HttpRouteParser;

		setBlocksExecutor(async () => ({ successful: true, output: {} }) as any);

		const ok = await dispatch(
			await envelopeFromHttp(
				postCtx("name=Alice", "application/x-www-form-urlencoded"),
			),
			parser,
		);
		expect(ok.status).toBe(200);

		const rejected = await dispatch(
			await envelopeFromHttp(
				postCtx("name=A", "application/x-www-form-urlencoded"),
			),
			parser,
		);
		expect(rejected.status).toBe(400);
		expect((rejected.data as any).errors[0].property).toBe("name");
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
