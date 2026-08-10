import { describe, expect, it } from "bun:test";
import {
	buildSuiteRequest,
	evaluateAssertions,
	type AssertionContext,
	type AssertionType,
} from "../assertions";

const suite = (overrides: Record<string, unknown> = {}) =>
	({
		id: "s1",
		headers: {},
		queryParams: {},
		routeParams: {},
		body: null,
		...overrides,
	}) as any;

const context = (overrides: Partial<AssertionContext> = {}): AssertionContext => ({
	status: 200,
	body: { user: { name: "ada" }, tags: ["a", "b"] },
	headers: { "content-type": "application/json" },
	durationMs: 12,
	request: {
		method: "GET",
		path: "/demo",
		headers: {},
		query: {},
		params: {},
		body: null,
	},
	...overrides,
});

const run = (assertions: AssertionType[], ctx = context()) =>
	evaluateAssertions(assertions, ctx);

describe("buildSuiteRequest", () => {
	it("substitutes path params and encodes them", () => {
		const request = buildSuiteRequest(
			suite({ routeParams: { id: "a b/c" } }),
			{ path: "/items/:id", method: "GET" } as any,
		);
		expect(request.path).toBe("/items/a%20b%2Fc");
	});

	it("leaves an unfilled param in place rather than writing undefined", () => {
		const request = buildSuiteRequest(suite({ routeParams: { id: "" } }), {
			path: "/items/:id",
			method: "GET",
		} as any);
		expect(request.path).toBe("/items/%3Aid");
	});

	it("defaults the content type for bodied methods only", () => {
		const post = buildSuiteRequest(suite(), { path: "/x", method: "post" } as any);
		expect(post.method).toBe("POST");
		expect(post.headers["Content-Type"]).toBe("application/json");

		const get = buildSuiteRequest(suite(), { path: "/x", method: "GET" } as any);
		expect(get.headers["Content-Type"]).toBeUndefined();
	});

	it("does not override a content type the suite already set", () => {
		const request = buildSuiteRequest(
			suite({ headers: { "content-type": "text/plain" } }),
			{ path: "/x", method: "PUT" } as any,
		);
		expect(request.headers).toEqual({ "content-type": "text/plain" });
	});
});

describe("evaluateAssertions", () => {
	it("keeps the shape the frontend renders", async () => {
		const verdict = await run([
			{ target: "status", operator: "eq", expectedValue: "200" } as AssertionType,
		]);
		expect(verdict).toEqual({
			success: true,
			result: [{ success: true, message: expect.stringContaining("Status") }],
			actualData: context().body,
		});
	});

	it("passes a suite that asserts nothing", async () => {
		expect((await run([])).success).toBe(true);
	});

	it("compares status and time numerically", async () => {
		const verdict = await run([
			{ target: "status", operator: "lt", expectedValue: "300" },
			{ target: "time", operator: "gt", expectedValue: "5" },
		] as AssertionType[]);
		expect(verdict.success).toBe(true);
	});

	it("walks a dotted body path, including array indexes", async () => {
		const verdict = await run([
			{ target: "body", propertyPath: "user.name", operator: "eq", expectedValue: "ada" },
			{ target: "body", propertyPath: "tags[1]", operator: "eq", expectedValue: "b" },
			{ target: "body", propertyPath: "user.email", operator: "not_exists" },
		] as AssertionType[]);
		expect(verdict.result.map((r) => r.success)).toEqual([true, true, true]);
	});

	it("evaluates header assertions against the real response headers", async () => {
		// dead until now: the in-process runner had no headers to read, so every
		// header assertion silently saw undefined
		const verdict = await run(
			[
				{ target: "header", propertyPath: "Content-Type", operator: "contains", expectedValue: "json" },
				{ target: "header", propertyPath: "x-missing", operator: "not_exists" },
			] as AssertionType[],
			context({ headers: { "content-type": "application/json" } }),
		);
		expect(verdict.result.map((r) => r.success)).toEqual([true, true]);
	});

	it("reports a failure with the actual value", async () => {
		const verdict = await run([
			{ target: "status", operator: "eq", expectedValue: "404" },
		] as AssertionType[]);
		expect(verdict.success).toBe(false);
		expect(verdict.result[0]!.message).toContain("got: 200");
	});

	it("runs customJs against the response and the request that produced it", async () => {
		const verdict = await run(
			[
				{
					target: "customJs",
					customJs: `return status === 201 && body.user.name === "ada" && fluxify.request.path === "/made-up";`,
				},
			] as AssertionType[],
			context({
				status: 201,
				request: { ...context().request, path: "/made-up" },
			}),
		);
		expect(verdict.success).toBe(true);
	});

	it("turns a throwing assertion into a failure, not a crashed run", async () => {
		const verdict = await run([
			{ target: "customJs", customJs: "throw new Error('boom')" },
		] as AssertionType[]);
		expect(verdict.success).toBe(false);
		expect(verdict.result[0]!.message).toContain("boom");
	});
});
