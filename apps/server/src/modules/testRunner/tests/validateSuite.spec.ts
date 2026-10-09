import { describe, expect, it } from "bun:test";
import type { AssertionType } from "../assertions";
import { checkAssertions, sampleOfRun } from "../validateSuite";

const check = (a: object) => a as AssertionType;
const badRequest = { status: 400, body: { message: "Body validation failed", errors: [] } };

describe("checkAssertions (#716)", () => {
	it("passes checks whose paths the response has", () => {
		const { checked, problems } = checkAssertions(
			[
				check({ target: "body", propertyPath: "message", operator: "contains", expectedValue: "fail" }),
				check({ target: "body", propertyPath: "errors[0]", operator: "not_exists" }),
				check({ target: "status", operator: "eq", expectedValue: "400" }),
			],
			badRequest,
		);
		expect(problems).toEqual([]);
		expect(checked).toBe(3);
	});

	it("reports a missing path with the keys that do exist", () => {
		const { problems } = checkAssertions(
			[check({ target: "body", propertyPath: "success", operator: "false" })],
			badRequest,
		);
		expect(problems).toEqual([
			"Check 1, body(success): (property not found: success). body has: message, errors",
		]);
	});

	it("reports a true/false check on a value that is not a boolean", () => {
		const { problems } = checkAssertions(
			[
				check({ target: "body", propertyPath: "message", operator: "true" }),
				check({ target: "body", propertyPath: "flag", operator: "true" }),
				check({ target: "body", propertyPath: "flag", operator: "false" }),
			],
			{ body: { message: "x", flag: false } },
		);
		expect(problems).toEqual(["Check 1, body(message): the value is string, not true or false"]);
	});

	it("reports an expected value that is not a number for status and time", () => {
		const { problems } = checkAssertions(
			[
				check({ target: "status", operator: "eq", expectedValue: "ok" }),
				check({ target: "time", operator: "lt", expectedValue: "" }),
			],
			badRequest,
		);
		expect(problems).toEqual([
			'Check 1, status: expected value "ok" is not a number',
			'Check 2, time: expected value "" is not a number',
		]);
	});

	it("checks headers by lowercase name and workflow outputs by path", () => {
		const { problems } = checkAssertions(
			[
				check({ target: "header", propertyPath: "X-Id", operator: "exists" }),
				check({ target: "output", propertyPath: "user.id", operator: "exists" }),
			],
			{ headers: { "content-type": "text/plain" }, output: { user: { name: "ada" } } },
		);
		expect(problems).toEqual([
			"Check 1, header(X-Id): (property not found: x-id). headers has: content-type",
			"Check 2, output(user.id): (property not found: user.id). user has: name",
		]);
	});

	it("leaves out what the sample does not hold, and custom JS", () => {
		const { checked, problems } = checkAssertions(
			[
				check({ target: "body", propertyPath: "id", operator: "exists" }),
				check({ target: "header", propertyPath: "x", operator: "exists" }),
				check({ target: "customJs", customJs: "t.expect(1).toBe(1)" }),
			],
			{ status: 200 },
		);
		expect(checked).toBe(0);
		expect(problems).toEqual([]);
	});
});

describe("sampleOfRun", () => {
	it("reads a route run's answer", () => {
		expect(
			sampleOfRun({
				success: true,
				result: [],
				statusCode: 201,
				headers: { a: "b" },
				actualData: { id: 1 },
			}),
		).toEqual({ status: 201, headers: { a: "b" }, body: { id: 1 } });
	});

	it("takes a successful workflow case first", () => {
		const run = (successful: boolean, output: unknown) => ({
			index: 0,
			name: "c",
			status: "passed" as const,
			checks: [],
			durationMs: 1,
			input: null,
			output: { successful, output },
		});
		expect(
			sampleOfRun({
				success: true,
				result: [],
				cases: [run(false, { error: true }), run(true, { id: 2 })],
			}),
		).toEqual({ output: { id: 2 } });
	});

	it("has nothing for a run that got no answer", () => {
		expect(sampleOfRun({ success: false, result: [], error: "Setup failed" })).toBeUndefined();
	});
});
