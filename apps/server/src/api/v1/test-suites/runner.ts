import { logger } from "@fluxify/common";
import type { InferSelectModel } from "drizzle-orm";
import type { routesEntity, testSuitesEntity } from "../../../db/schema";
import {
	buildSuiteRequest,
	evaluateAssertions,
	type AssertionType,
} from "../../../modules/testRunner/assertions";
import * as requestRouterService from "../../../modules/requestRouter/service";

export type { AssertionType };

/**
 * The legacy in-process runner: the suite executes inside the admin process,
 * with its credentials and its memory. #220 deletes this and its two endpoints
 * in favour of `modules/testRunner/runner.ts`, which runs the same suite in a
 * cold child process.
 */
export async function runSuiteAssertions(
	suite: InferSelectModel<typeof testSuitesEntity>,
	route: InferSelectModel<typeof routesEntity>,
	_executeRouteInternal = requestRouterService.executeRouteInternal,
) {
	const request = buildSuiteRequest(suite, route);

	const overrides: requestRouterService.RequestOverrides = {
		integrations: Array.isArray(suite.integrationOverrides)
			? suite.integrationOverrides
			: [],
		appConfigs: Array.isArray(suite.appConfigOverrides)
			? suite.appConfigOverrides
			: [],
	};

	let resStatus = 500;
	let resBody: unknown = null;
	const startTime = Date.now();

	try {
		const result = await _executeRouteInternal(
			{
				id: route.id,
				projectId: route.projectId!,
				projectName: "", // We might not have this here, but it's okay for testing
				routeParams: request.params,
				bodySchema: route.bodySchema,
				querySchema: route.querySchema,
				paramsSchema: route.paramsSchema,
			},
			{
				method: request.method,
				path: request.path,
				headers: request.headers,
				query: request.query,
				body: request.body,
				params: request.params,
			},
			undefined,
			overrides,
		);

		resStatus = result.status;
		resBody = result.data;
	} catch (e: any) {
		logger.error("Test suite runner error", "runner", { error: e });
		resStatus = 500;
		resBody = { error: e.message };
	}

	return evaluateAssertions((suite.assertions as AssertionType[]) || [], {
		status: resStatus,
		body: resBody,
		// executeRouteInternal doesn't return headers; the sandboxed runner does,
		// so header assertions only actually evaluate there
		headers: {},
		durationMs: Date.now() - startTime,
		request,
	});
}
