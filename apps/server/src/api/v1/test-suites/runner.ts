import { testSuitesEntity, routesEntity } from "../../../db/schema";
import { InferSelectModel } from "drizzle-orm";
import { JsVM } from "@fluxify/lib";
import { z } from "zod";
import { assertionSchema } from "./schema";
import * as requestRouterService from "../../../modules/requestRouter/service";

export type AssertionType = z.infer<typeof assertionSchema>;

export async function runSuiteAssertions(
	suite: InferSelectModel<typeof testSuitesEntity>,
	route: InferSelectModel<typeof routesEntity>,
	_executeRouteInternal = requestRouterService.executeRouteInternal
) {
	let finalPath = route.path || "";
	const pathParams = (suite.routeParams as Record<string, string>) || {};

	Object.entries(pathParams).forEach(([key, value]) => {
		finalPath = finalPath.replace(
			`:${key}`,
			encodeURIComponent(value || `:${key}`),
		);
	});

	const queryParams = (suite.queryParams as Record<string, string>) || {};
	const headers = (suite.headers as Record<string, string>) || {};
	const method = route.method || "GET";

	// default json
	const lowerHeaders = Object.keys(headers).reduce((acc, k) => {
		acc[k.toLowerCase()] = headers[k];
		return acc;
	}, {} as Record<string, string>);

	if (
		!lowerHeaders["content-type"] &&
		["POST", "PUT"].includes(method.toUpperCase())
	) {
		headers["Content-Type"] = "application/json";
	}

	const overrides: requestRouterService.RequestOverrides = {
		integrations: Array.isArray(suite.integrationOverrides) ? suite.integrationOverrides : [],
		appConfigs: Array.isArray(suite.appConfigOverrides) ? suite.appConfigOverrides : [],
	};

	let resStatus: number = 500;
	let resBody: unknown = null;
	const startTime = Date.now();

	try {
		const result = await _executeRouteInternal(
			{
				id: route.id,
				projectId: route.projectId!,
				projectName: "", // We might not have this here, but it's okay for testing
				routeParams: pathParams,
				bodySchema: route.bodySchema,
				querySchema: route.querySchema,
				paramsSchema: route.paramsSchema,
			},
			{
				method: method.toUpperCase(),
				path: finalPath,
				headers,
				query: queryParams,
				body: suite.body,
				params: pathParams,
			},
			undefined,
			overrides
		);

		resStatus = result.status;
		resBody = result.data;
	} catch (e: any) {
		console.error("RUNNER ERROR:", e);
		resStatus = 500;
		resBody = { error: e.message };
	}

	const time = Date.now() - startTime;
	const resHeaders: Record<string, string> = {}; // executeRouteInternal doesn't currently return headers

	const assertions = (suite.assertions as AssertionType[]) || [];
	const result = assertions.map((a: AssertionType) => {
		let actualValue: unknown;
		let targetDesc = "";

		try {
			if (a.target === "status") {
				actualValue = resStatus;
				targetDesc = "Status";
			} else if (a.target === "time") {
				actualValue = time;
				targetDesc = "Time";
			} else if (a.target === "header") {
				actualValue = resHeaders[(a.propertyPath || "").toLowerCase()];
				targetDesc = `Header(${a.propertyPath})`;
			} else if (a.target === "body") {
				// Evaluate dot-notation path
				if (a.propertyPath) {
					const parts = a.propertyPath
						.replace(/\[(\d+)\]/g, ".$1")
						.split(".")
						.filter(Boolean);
					let curr: any = resBody;
					for (const p of parts) {
						if (curr === undefined || curr === null) break;
						curr = curr[p];
					}
					actualValue = curr;
				} else {
					actualValue = resBody;
				}
				targetDesc = `Body(${a.propertyPath || ""})`;
			} else if (a.target === "customJs") {
				const vm = new JsVM({
					fluxify: {
						request: {
							path: finalPath,
							query: queryParams,
							body: suite.body,
							headers,
							params: pathParams,
						}
					},
					body: resBody,
					headers: resHeaders,
					status: resStatus,
				});
				actualValue = vm.run(a.customJs || "return true;");
				targetDesc = "Custom JS";
			}

			let passed = false;
			if (a.target === "customJs") {
				passed = new JsVM({}).truthy(actualValue);
			}

			const expected = a.expectedValue == null ? "" : String(a.expectedValue);
			const actualStr = actualValue == null ? "" : String(actualValue);

			if (a.target !== "customJs") {
				switch (a.operator) {
					case "eq":
						passed = actualStr === expected || String(actualValue) === expected;
						if (a.target === "status" || a.target === "time") {
							passed = Number(actualValue) === Number(expected);
						}
						break;
					case "neq":
						passed = actualStr !== expected;
						if (a.target === "status" || a.target === "time") {
							passed = Number(actualValue) !== Number(expected);
						}
						break;
					case "lt":
						passed = Number(actualValue) < Number(expected);
						break;
					case "gt":
						passed = Number(actualValue) > Number(expected);
						break;
					case "contains":
						passed =
							typeof actualValue === "string"
								? actualValue.includes(expected)
								: JSON.stringify(actualValue).includes(expected);
						break;
					case "true":
						passed = actualValue === true || actualStr === "true";
						break;
					case "false":
						passed = actualValue === false || actualStr === "false";
						break;
					case "exists":
						passed = actualValue !== undefined && actualValue !== null;
						break;
					case "not_exists":
						passed = actualValue === undefined || actualValue === null;
						break;
					default:
						passed = false;
				}
			}

			const opStr = a.operator ? a.operator.replace("_", " ") : "";
			return {
				success: passed,
				message: passed
					? `${targetDesc} ${a.target !== "customJs" ? opStr + " " + (a.expectedValue || "") : ""} ✓`
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
	});

	const allPassed = result.length === 0 || result.every((r) => r.success);

	return {
		success: allPassed,
		result,
		actualData: resBody,
	};
}
