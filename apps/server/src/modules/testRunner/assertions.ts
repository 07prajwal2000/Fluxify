import { JsVM } from "@fluxify/lib";
import type { InferSelectModel } from "drizzle-orm";
import { z } from "zod";
import type { assertionSchema } from "../../api/v1/test-suites/schema";
import type { AssertionResult, routesEntity, testSuitesEntity } from "../../db/schema";
import { createExpect } from "./expect";

export type AssertionType = z.infer<typeof assertionSchema>;

type Suite = InferSelectModel<typeof testSuitesEntity>;
type Route = InferSelectModel<typeof routesEntity>;

export type SuiteRequest = {
	method: string;
	path: string;
	headers: Record<string, string>;
	query: Record<string, string>;
	params: Record<string, string>;
	body: unknown;
};

/**
 * The HTTP request one suite sends, built from the suite's mock data and the
 * route's own path.
 *
 * Shared by both runners so the in-process path and the sandboxed one send the
 * same request — a suite that passes in one and fails in the other because a
 * path param was substituted differently is the worst kind of bug to chase.
 */
export function buildSuiteRequest(
	suite: Suite,
	route: Pick<Route, "path" | "method">,
): SuiteRequest {
	const params = (suite.routeParams as Record<string, string>) || {};
	// an unfilled param stays as ":id" rather than becoming "undefined", so the
	// route simply does not match and the failure names the missing param
	const path = Object.entries(params).reduce(
		(acc, [key, value]) => acc.replace(`:${key}`, encodeURIComponent(value || `:${key}`)),
		route.path || "",
	);

	const headers = { ...((suite.headers as Record<string, string>) || {}) };
	const method = (route.method || "GET").toUpperCase();
	const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
	if (!hasContentType && ["POST", "PUT"].includes(method)) {
		headers["Content-Type"] = suite.contentType ?? "application/json";
	}

	return {
		method,
		path,
		headers,
		query: (suite.queryParams as Record<string, string>) || {},
		params,
		body: suite.body,
	};
}

/** what a workflow run produced (#487), the value its checks read */
export type WorkflowOutcome = { successful: boolean; output: unknown; error?: string };

/** the case being checked, as `t.case` */
export type CaseInfo = { index: number; name: string; input: unknown };

/**
 * What an assertion set is evaluated against: a route's response, or one
 * workflow case (#487). Route targets read nothing on a workflow and vice versa.
 */
export type AssertionContext = {
	durationMs: number;
	/** what the setup block returned, as `t.setup` (#483) */
	setup?: unknown;
	case?: CaseInfo;
} & (
	| {
			status: number;
			body: unknown;
			headers: Record<string, string>;
			request: SuiteRequest;
			workflow?: undefined;
	  }
	| { workflow: WorkflowOutcome; status?: undefined; body?: undefined; headers?: undefined }
);

/** an empty path is the whole body; `a.b[0].c` walks into it */
function readPath(body: unknown, propertyPath?: string | null) {
	if (!propertyPath) return body;
	const parts = propertyPath
		.replace(/\[(\d+)\]/g, ".$1")
		.split(".")
		.filter(Boolean);
	let curr: any = body;
	for (const p of parts) {
		if (curr === undefined || curr === null) break;
		curr = curr[p];
	}
	return curr;
}

function actualFor(a: AssertionType, ctx: AssertionContext) {
	switch (a.target) {
		case "status":
			return { value: ctx.status as unknown, desc: "Status" };
		case "time":
			return { value: ctx.durationMs as unknown, desc: "Time" };
		case "header":
			return {
				value: ctx.headers?.[(a.propertyPath || "").toLowerCase()] as unknown,
				desc: `Header(${a.propertyPath})`,
			};
		case "body":
			return {
				value: readPath(ctx.body, a.propertyPath),
				desc: `Body(${a.propertyPath || ""})`,
			};
		case "output":
			return {
				value: readPath(ctx.workflow?.output, a.propertyPath),
				desc: `Output(${a.propertyPath || ""})`,
			};
		case "successful":
			return { value: ctx.workflow?.successful as unknown, desc: "Successful" };
		default:
			return { value: undefined as unknown, desc: "" };
	}
}

function compare(a: AssertionType, actualValue: unknown) {
	const expected = a.expectedValue == null ? "" : String(a.expectedValue);
	// an object stringifies to "[object Object]", which no expected value matches
	const actualStr =
		actualValue == null
			? ""
			: typeof actualValue === "object"
				? JSON.stringify(actualValue)
				: String(actualValue);
	const numeric = a.target === "status" || a.target === "time";

	switch (a.operator) {
		case "eq":
			return numeric ? Number(actualValue) === Number(expected) : actualStr === expected;
		case "neq":
			return numeric ? Number(actualValue) !== Number(expected) : actualStr !== expected;
		case "lt":
			return Number(actualValue) < Number(expected);
		case "gt":
			return Number(actualValue) > Number(expected);
		case "contains":
			return typeof actualValue === "string"
				? actualValue.includes(expected)
				: JSON.stringify(actualValue).includes(expected);
		case "true":
			return actualValue === true || actualStr === "true";
		case "false":
			return actualValue === false || actualStr === "false";
		case "exists":
			return actualValue !== undefined && actualValue !== null;
		case "not_exists":
			return actualValue === undefined || actualValue === null;
		default:
			return false;
	}
}

/**
 * Every assertion's verdict for one response.
 *
 * Evaluated in the suite's child, after the route: custom JS assertions are
 * user code, so they run where the route does and never in a process that holds
 * system secrets. A route that tampers with globals can skew its own verdict —
 * that is the user fooling themselves, not a boundary crossed.
 *
 * The return shape is the one the frontend already renders — do not change it
 * without changing `SuiteRunResult` and the UI together.
 */
export async function evaluateAssertions(assertions: AssertionType[], ctx: AssertionContext) {
	const rows = await Promise.all(
		assertions.map(async (a): Promise<AssertionResult[]> => {
			try {
				if (a.target === "customJs") return await runCustomJs(a.customJs ?? "", ctx);
				const { value: actualValue, desc: targetDesc } = actualFor(a, ctx);
				const passed = compare(a, actualValue);

				const actualStr = actualValue == null ? "" : String(actualValue);
				const opStr = a.operator ? a.operator.replace("_", " ") : "";
				return [
					{
						success: passed,
						message: passed
							? `${targetDesc} ${opStr} ${a.expectedValue || ""} ✓`
							: `Expected ${targetDesc} to ${opStr} ${a.expectedValue || ""}, got: ${actualStr}`,
					},
				];
			} catch (err: unknown) {
				return [
					{
						success: false,
						message: `Evaluation error: ${err instanceof Error ? err.message : String(err)}`,
					},
				];
			}
		}),
	);
	const result = rows.flat();

	return {
		// a suite with no assertions passes: it asserted nothing and nothing broke
		success: result.length === 0 || result.every((r) => r.success),
		result,
		actualData: ctx.workflow ? ctx.workflow.output : ctx.body,
	};
}

/**
 * A custom JS assertion checks with `t.expect`; each check is its own result
 * line, so a failure says what broke. The return value is ignored.
 *
 * No check at all fails: an assertion written for the old "truthy return"
 * style would otherwise pass without testing anything.
 */
async function runCustomJs(code: string, ctx: AssertionContext): Promise<AssertionResult[]> {
	const checks: AssertionResult[] = [];
	const fluxify = ctx.workflow
		? { input: ctx.case?.input, result: ctx.workflow }
		: {
				request: {
					path: ctx.request.path,
					query: ctx.request.query,
					body: ctx.request.body,
					headers: ctx.request.headers,
					params: ctx.request.params,
				},
				response: { body: ctx.body, headers: ctx.headers, status: ctx.status },
			};
	const vm = new JsVM({
		fluxify,
		t: {
			expect: createExpect((r) => checks.push(r)),
			zod: z,
			setup: ctx.setup,
			case: ctx.case,
		},
	});
	await vm.runAsync(code);
	if (checks.length === 0) {
		return [{ success: false, message: "Custom JS made no t.expect(...) checks" }];
	}
	return checks;
}
