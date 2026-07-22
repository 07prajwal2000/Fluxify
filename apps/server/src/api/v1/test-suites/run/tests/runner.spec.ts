import { describe, expect, it, mock } from "bun:test";
import { runSuiteAssertions } from "../../runner";

describe("runSuiteAssertions", () => {
	it("should apply integration overrides to executeRouteInternal", async () => {
		const executeRouteInternalMock = mock(async () => {
			return {
				status: 200,
				data: { success: true, db_result: "mocked" },
			};
		});

		const suite = {
			id: "suite_1",
			name: "Test Suite",
			description: null,
			routeId: "route_1",
			headers: { "x-test": "value" },
			params: {},
			queryParams: {},
			routeParams: {},
			body: { name: "test" },
			assertions: [
				{ target: "status", operator: "eq", expectedValue: "200" },
				{
					target: "body",
					propertyPath: "db_result",
					operator: "eq",
					expectedValue: "mocked",
				},
			],
			integrationOverrides: [
				{ existingId: "prod-db-123", newId: "test-db-123" },
			],
			appConfigOverrides: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		const route = {
			id: "route_1",
			name: "My Route",
			path: "/api/test",
			active: true,
			projectId: "proj_1",
			method: "POST",
			bodySchema: null,
			querySchema: null,
			paramsSchema: null,
			createdAt: new Date(),
			createdBy: null,
			updatedAt: new Date(),
		};

		const result = await runSuiteAssertions(
			suite as any,
			route as any,
			executeRouteInternalMock as any,
		);

		expect(executeRouteInternalMock).toHaveBeenCalledTimes(1);

		const callArgs = executeRouteInternalMock.mock.calls[0] as any;
		// Argument 3 is ctx (undefined), Argument 4 is overrides
		expect(callArgs[3]).toEqual({
			integrations: [{ existingId: "prod-db-123", newId: "test-db-123" }],
			appConfigs: [],
		});

		expect(result.success).toBe(true);
		expect(result.actualData).toEqual({ success: true, db_result: "mocked" });
	});

	it("should provide fluxify.request.* in customJs assertion", async () => {
		const executeRouteInternalMock = mock(async () => {
			return {
				status: 200,
				data: { result: "ok" },
			};
		});

		const suite = {
			id: "suite_2",
			name: "Test Suite JS",
			description: null,
			routeId: "route_2",
			headers: { authorization: "Bearer token" },
			params: {},
			queryParams: { q: "search" },
			routeParams: { id: "10" },
			body: { test: "data" },
			assertions: [
				{
					target: "customJs",
					customJs: `
						// Verify request properties are exposed correctly
						return fluxify.request.path === "/api/items/10" &&
							   fluxify.request.query.q === "search" &&
							   fluxify.request.body.test === "data" &&
							   fluxify.request.headers.authorization === "Bearer token" &&
							   status === 200;
					`,
				},
			],
			integrationOverrides: [],
			appConfigOverrides: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		const route = {
			id: "route_2",
			name: "My Route JS",
			path: "/api/items/:id",
			active: true,
			projectId: "proj_1",
			method: "POST",
			bodySchema: null,
			querySchema: null,
			paramsSchema: null,
			createdAt: new Date(),
			createdBy: null,
			updatedAt: new Date(),
		};

		const result = await runSuiteAssertions(
			suite as any,
			route as any,
			executeRouteInternalMock as any,
		);

		expect(result.success).toBe(true);
		expect(result.result[0].success).toBe(true);
	});
});
