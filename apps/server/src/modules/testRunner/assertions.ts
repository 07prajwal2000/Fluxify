import { JsVM } from "@fluxify/lib";
import type { InferSelectModel } from "drizzle-orm";
import type { z } from "zod";
import type { assertionSchema } from "../../api/v1/test-suites/schema";
import type { routesEntity, testSuitesEntity } from "../../db/schema";

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
		(acc, [key, value]) =>
			acc.replace(`:${key}`, encodeURIComponent(value || `:${key}`)),
		route.path || "",
	);

	const headers = { ...((suite.headers as Record<string, string>) || {}) };
	const method = (route.method || "GET").toUpperCase();
	const hasContentType = Object.keys(headers).some(
		(k) => k.toLowerCase() === "content-type",
	);
	if (!hasContentType && ["POST", "PUT"].includes(method)) {
		headers["Content-Type"] = "application/json";
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

/** the response an assertion set is evaluated against */
export type AssertionContext = {
	status: number;
	body: unknown;
	headers: Record<string, string>;
	durationMs: number;
	request: SuiteRequest;
};

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

async function actualFor(a: AssertionType, ctx: AssertionContext) {
	switch (a.target) {
		case "status":
			return { value: ctx.status as unknown, desc: "Status" };
		case "time":
			return { value: ctx.durationMs as unknown, desc: "Time" };
		case "header":
			return {
				value: ctx.headers[(a.propertyPath || "").toLowerCase()] as unknown,
				desc: `Header(${a.propertyPath})`,
			};
		case "body":
			return {
				value: readPath(ctx.body, a.propertyPath),
				desc: `Body(${a.propertyPath || ""})`,
			};
		case "customJs": {
			const vm = new JsVM({
				fluxify: {
					request: {
						path: ctx.request.path,
						query: ctx.request.query,
						body: ctx.request.body,
						headers: ctx.request.headers,
						params: ctx.request.params,
					},
					response: {
						body: ctx.body,
						headers: ctx.headers,
						status: ctx.status,
					},
				},
			});
			return {
				value: await vm.run(a.customJs || "return true;"),
				desc: "Custom JS",
			};
		}
		default:
			return { value: undefined as unknown, desc: "" };
	}
}

function compare(a: AssertionType, actualValue: unknown) {
	const expected = a.expectedValue == null ? "" : String(a.expectedValue);
	const actualStr = actualValue == null ? "" : String(actualValue);
	const numeric = a.target === "status" || a.target === "time";

	switch (a.operator) {
		case "eq":
			return numeric
				? Number(actualValue) === Number(expected)
				: actualStr === expected;
		case "neq":
			return numeric
				? Number(actualValue) !== Number(expected)
				: actualStr !== expected;
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
 * Evaluated in the PARENT, never in the suite's child process: assertions are
 * the thing the sandbox is not trusted to report honestly, and a killed child
 * has no results to send anyway.
 *
 * The return shape is the one the frontend already renders — do not change it
 * without changing `SuiteRunResult` and the UI together.
 */
export async function evaluateAssertions(
	assertions: AssertionType[],
	ctx: AssertionContext,
) {
	const result = await Promise.all(
		assertions.map(async (a) => {
			try {
				const { value: actualValue, desc: targetDesc } = await actualFor(a, ctx);
				const passed =
					a.target === "customJs"
						? new JsVM({}).truthy(actualValue)
						: compare(a, actualValue);

				const actualStr = actualValue == null ? "" : String(actualValue);
				const opStr = a.operator ? a.operator.replace("_", " ") : "";
				return {
					success: passed,
					message: passed
						? `${targetDesc} ${a.target !== "customJs" ? `${opStr} ${a.expectedValue || ""}` : ""} ✓`
						: a.target === "customJs"
							? `Custom JS evaluated to falsy (${actualStr})`
							: `Expected ${targetDesc} to ${opStr} ${a.expectedValue || ""}, got: ${actualStr}`,
				};
			} catch (err: unknown) {
				return {
					success: false,
					message: `Evaluation error: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
		}),
	);

	return {
		// a suite with no assertions passes: it asserted nothing and nothing broke
		success: result.length === 0 || result.every((r) => r.success),
		result,
		actualData: ctx.body,
	};
}
