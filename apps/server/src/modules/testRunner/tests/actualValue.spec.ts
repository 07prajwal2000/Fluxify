import { describe, expect, it } from "bun:test";
import { type AssertionContext, type AssertionType, evaluateAssertions } from "../assertions";

const ctx = (body: unknown, headers: Record<string, string> = {}): AssertionContext => ({
	status: 400,
	body,
	headers,
	durationMs: 5,
	request: { method: "POST", path: "/x", headers: {}, query: {}, params: {}, body: null },
});

/** the one failure message of a single check */
async function failure(assertion: object, context: AssertionContext) {
	const verdict = await evaluateAssertions([assertion as AssertionType], context);
	expect(verdict.success).toBe(false);
	return verdict.result[0]!.message;
}

describe("failed check messages (#716)", () => {
	it("names a missing property and the keys that do exist", async () => {
		const message = await failure(
			{ target: "body", propertyPath: "success", operator: "false" },
			ctx({ message: "Body validation failed", errors: [] }),
		);
		expect(message).toBe(
			"Expected Body(success) to false , got: (property not found: success). body has: message, errors",
		);
	});

	it("points at the first missing step of a nested path", async () => {
		const message = await failure(
			{ target: "body", propertyPath: "user.address.city", operator: "eq", expectedValue: "x" },
			ctx({ user: { name: "ada", age: 3 } }),
		);
		expect(message).toContain("got: (property not found: user.address). user has: name, age");
	});

	it("says when the level above is not an object", async () => {
		const list = await failure(
			{ target: "body", propertyPath: "id", operator: "exists" },
			ctx([1, 2]),
		);
		expect(list).toContain("(property not found: id). body is a list of 2 items");
		const text = await failure(
			{ target: "body", propertyPath: "id", operator: "exists" },
			ctx("Not Found"),
		);
		expect(text).toContain('body is "Not Found"');
	});

	it("says there is no body at all", async () => {
		const message = await failure(
			{ target: "body", operator: "exists" },
			ctx(undefined),
		);
		expect(message).toContain("got: (no body)");
	});

	it("prints null as null and strings quoted", async () => {
		expect(
			await failure({ target: "body", propertyPath: "a", operator: "eq", expectedValue: "1" }, ctx({ a: null })),
		).toEndWith("got: null");
		expect(
			await failure({ target: "body", propertyPath: "a", operator: "eq", expectedValue: "1" }, ctx({ a: "" })),
		).toEndWith('got: ""');
		expect(
			await failure({ target: "body", propertyPath: "a", operator: "eq", expectedValue: "1" }, ctx({ a: "two" })),
		).toEndWith('got: "two"');
	});

	it("prints an object as JSON, cut when long", async () => {
		const small = await failure(
			{ target: "body", propertyPath: "a", operator: "eq", expectedValue: "1" },
			ctx({ a: { b: [1, 2] } }),
		);
		expect(small).toEndWith('got: {"b":[1,2]}');

		const big = await failure(
			{ target: "body", propertyPath: "a", operator: "eq", expectedValue: "1" },
			ctx({ a: { text: "x".repeat(1000) } }),
		);
		expect(big).toContain("…");
		expect(big.length).toBeLessThan(400);
	});

	it("names a missing header and the headers that came back", async () => {
		const message = await failure(
			{ target: "header", propertyPath: "X-Id", operator: "exists" },
			ctx({}, { "content-type": "text/plain" }),
		);
		expect(message).toContain("(property not found: x-id). headers has: content-type");
	});

	it("reads a workflow's missing output property the same way", async () => {
		const verdict = await evaluateAssertions(
			[{ target: "output", propertyPath: "id", operator: "exists" } as AssertionType],
			{ durationMs: 1, workflow: { successful: true, output: { ok: true } } },
		);
		expect(verdict.result[0]!.message).toContain("(property not found: id). output has: ok");
	});
});
