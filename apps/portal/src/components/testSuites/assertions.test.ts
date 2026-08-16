import { describe, expect, test } from "bun:test";
import {
	methodTakesBody,
	normalizeAssertion,
	pathParamsOf,
	validateAssertion,
} from "./assertions";

describe("assertion validation", () => {
	test("accepts a valid pair", () => {
		expect(
			validateAssertion({ target: "status", operator: "eq", expectedValue: "200" }),
		).toBeNull();
	});

	test("rejects an operator the target does not allow", () => {
		expect(
			validateAssertion({ target: "status", operator: "contains", expectedValue: "2" }),
		).not.toBeNull();
	});

	test("rejects a property path outside the body", () => {
		expect(
			validateAssertion({
				target: "header",
				operator: "eq",
				expectedValue: "a",
				propertyPath: "data.id",
			}),
		).not.toBeNull();
	});

	test("expected value is required only for value operators", () => {
		expect(validateAssertion({ target: "body", operator: "exists" })).toBeNull();
		expect(validateAssertion({ target: "body", operator: "eq" })).not.toBeNull();
	});

	test("numeric targets reject a non-number", () => {
		expect(
			validateAssertion({ target: "time", operator: "lt", expectedValue: "fast" }),
		).not.toBeNull();
	});

	test("customJs needs an expression, not an operator", () => {
		expect(validateAssertion({ target: "customJs", customJs: "status === 200" })).toBeNull();
		expect(validateAssertion({ target: "customJs", customJs: "  " })).not.toBeNull();
	});
});

describe("normalizeAssertion", () => {
	test("drops a stale property path when the target changes", () => {
		const next = normalizeAssertion({
			target: "status",
			operator: "eq",
			expectedValue: "200",
			propertyPath: "data.id",
		});
		expect(next.propertyPath).toBeNull();
	});

	test("repairs an operator the new target forbids", () => {
		const next = normalizeAssertion({ target: "status", operator: "contains" });
		expect(next.operator).toBe("eq");
	});

	test("clears the expected value for a valueless operator", () => {
		const next = normalizeAssertion({
			target: "body",
			operator: "exists",
			expectedValue: "leftover",
		});
		expect(next.expectedValue).toBeNull();
	});
});

test("pathParamsOf reads the route's own segments", () => {
	expect(pathParamsOf("/users/:id/posts/:postId")).toEqual(["id", "postId"]);
	expect(pathParamsOf("/users")).toEqual([]);
	expect(pathParamsOf(undefined)).toEqual([]);
});

test("methodTakesBody follows the HTTP methods that carry one", () => {
	expect(methodTakesBody("POST")).toBe(true);
	expect(methodTakesBody("get")).toBe(false);
});
