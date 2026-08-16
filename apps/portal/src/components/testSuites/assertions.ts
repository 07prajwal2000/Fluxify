/**
 * Assertion rules, mirrored from the server's `superRefine`
 * (`apps/server/src/api/v1/test-suites/schema.ts`). Kept in one place so the
 * editor can disable an invalid pair instead of letting the user discover it
 * from a 400.
 */

export const ASSERTION_TARGETS = [
	"status",
	"body",
	"time",
	"header",
	"customJs",
] as const;

export type AssertionTarget = (typeof ASSERTION_TARGETS)[number];

export const ASSERTION_OPERATORS = [
	"eq",
	"neq",
	"lt",
	"gt",
	"contains",
	"true",
	"false",
	"exists",
	"not_exists",
] as const;

export type AssertionOperator = (typeof ASSERTION_OPERATORS)[number];

export type Assertion = {
	target: AssertionTarget;
	propertyPath?: string | null;
	operator?: AssertionOperator | null;
	expectedValue?: string | null;
	customJs?: string | null;
};

/** `customJs` has none: the expression itself is the assertion. */
const OPERATORS_BY_TARGET: Record<AssertionTarget, AssertionOperator[]> = {
	status: ["eq", "neq", "lt", "gt"],
	time: ["eq", "neq", "lt", "gt"],
	body: ["eq", "neq", "contains", "true", "false", "exists", "not_exists"],
	header: ["eq", "neq", "contains", "true", "false", "exists", "not_exists"],
	customJs: [],
};

/** Operators that assert on their own — an expected value would mean nothing. */
const VALUELESS_OPERATORS: AssertionOperator[] = [
	"true",
	"false",
	"exists",
	"not_exists",
];

export const OPERATOR_LABELS: Record<AssertionOperator, string> = {
	eq: "equals",
	neq: "not equals",
	lt: "less than",
	gt: "greater than",
	contains: "contains",
	true: "is true",
	false: "is false",
	exists: "exists",
	not_exists: "does not exist",
};

export const TARGET_LABELS: Record<AssertionTarget, string> = {
	status: "Status code",
	body: "Response body",
	time: "Duration (ms)",
	header: "Header",
	customJs: "Custom JS",
};

export function operatorsFor(target: AssertionTarget): AssertionOperator[] {
	return OPERATORS_BY_TARGET[target];
}

/** Only `body` addresses into a structure, so only it may carry a path. */
export function allowsPropertyPath(target: AssertionTarget): boolean {
	return target === "body";
}

export function needsExpectedValue(
	target: AssertionTarget,
	operator?: AssertionOperator | null,
): boolean {
	if (target === "customJs") return false;
	return !operator || !VALUELESS_OPERATORS.includes(operator);
}

/** Returns a message per invalid assertion, keyed by its index. */
export function validateAssertions(
	assertions: Assertion[],
): Map<number, string> {
	const errors = new Map<number, string>();
	assertions.forEach((assertion, index) => {
		const error = validateAssertion(assertion);
		if (error) errors.set(index, error);
	});
	return errors;
}

export function validateAssertion(assertion: Assertion): string | null {
	const { target, operator, expectedValue, propertyPath, customJs } = assertion;

	if (target === "customJs") {
		return customJs?.trim() ? null : "Write the expression to evaluate";
	}

	if (propertyPath && !allowsPropertyPath(target)) {
		return "A property path only applies to the response body";
	}
	if (!operator) return "Pick an operator";
	if (!operatorsFor(target).includes(operator)) {
		return `'${OPERATOR_LABELS[operator]}' does not apply to ${TARGET_LABELS[target].toLowerCase()}`;
	}
	if (needsExpectedValue(target, operator) && !expectedValue?.trim()) {
		return "Expected value is required";
	}
	if (
		(target === "status" || target === "time") &&
		expectedValue &&
		Number.isNaN(Number(expectedValue))
	) {
		return "Expected value must be a number";
	}
	return null;
}

/**
 * Drops the fields the server rejects for the chosen target, so switching a
 * target in the UI cannot smuggle a stale property path into the payload.
 */
export function normalizeAssertion(assertion: Assertion): Assertion {
	if (assertion.target === "customJs") {
		return { target: "customJs", customJs: assertion.customJs ?? "" };
	}
	const operator = operatorsFor(assertion.target).includes(
		assertion.operator as AssertionOperator,
	)
		? assertion.operator
		: operatorsFor(assertion.target)[0];
	return {
		target: assertion.target,
		operator,
		propertyPath: allowsPropertyPath(assertion.target)
			? (assertion.propertyPath ?? null)
			: null,
		expectedValue: needsExpectedValue(assertion.target, operator)
			? (assertion.expectedValue ?? "")
			: null,
	};
}

/** `/users/:id/posts/:postId` -> `["id", "postId"]` */
export function pathParamsOf(routePath: string | undefined): string[] {
	if (!routePath) return [];
	return [...routePath.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
}

/** Methods with no request body — the editor hides the body tab for these. */
export function methodTakesBody(method: string | undefined): boolean {
	return !!method && !["GET", "HEAD", "DELETE", "OPTIONS"].includes(method.toUpperCase());
}
