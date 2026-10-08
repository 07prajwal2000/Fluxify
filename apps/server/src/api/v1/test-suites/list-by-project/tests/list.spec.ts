import { describe, expect, it, mock } from "bun:test";
import { Hono } from "hono";

const rows = [
	{
		id: "0190a000-0000-7000-8000-000000000001",
		name: "Returns the user",
		description: "",
		targetId: "r1",
		targetName: "Get user",
		targetType: "route",
	},
];
const getProjectTestSuites = mock(async (_projectId: string) => rows);

mock.module("../repository", () => ({ getProjectTestSuites }));
mock.module("../../../../auth/middleware", () => ({
	requireProjectAccess: () => async (_ctx: any, next: any) => next(),
}));

const { default: testSuitesRegister } = await import("../../register");
const app = new Hono<any>();
testSuitesRegister.registerHandler(app);

describe("Test Suites Endpoints - list by project", () => {
	it("returns every suite of the project with its target", async () => {
		const res = await app.request("http://localhost/test-suites/project/p1");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(rows);
		expect(getProjectTestSuites).toHaveBeenCalledWith("p1");
	});
});
