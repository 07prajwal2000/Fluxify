import {
	describe,
	it,
	expect,
	beforeEach,
	mock,
	spyOn,
	type Mock,
} from "bun:test";
import { db } from "../../../../../db";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ForbiddenError } from "../../../../../errors/forbidError";
import handleRequest from "../service";
import { HttpMethod, AuthACL } from "../../../../../db/schema";

// Mock all imports - must use paths relative to this file
mock.module("../../../../../db", () => ({
	db: {
		transaction: mock(),
	},
}));
mock.module("../../../../../db/redis", () => ({
	publishMessage: mock(),
	CHAN_ON_ROUTE_CHANGE: "",
}));
mock.module("../../update/repository", () => ({
	getRouteByNameOrPath: mock(),
	updateRoute: mock(),
}));

// Import mocked functions after mocking
const { getRouteByNameOrPath, updateRoute } =
	await import("../../update/repository");

describe("update-partial route", () => {
	beforeEach(() => {});

	it("should have auth layer validation", () => {
		// This test verifies that the service accepts acl parameter
		// Real functionality is tested in update.spec.ts
		expect(handleRequest.length).toBe(2); // id, data (acl has default value)
	});

	it("should throw ForbiddenError when user lacks project access", async () => {
		(db.transaction as any).mockImplementation(async (callback: any) => {
			const mockTx = {};
			return await callback(mockTx);
		});

		const mockRoute = {
			id: "123",
			name: "Original",
			path: "/original",
			method: HttpMethod.GET,
			projectId: "proj2",
			active: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		(getRouteByNameOrPath as any).mockResolvedValueOnce(mockRoute);

		const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
		await expect(
			handleRequest("123", { name: "Updated" }, acl),
		).rejects.toThrow(ForbiddenError);
	});

	it("should allow system admin to update any route", async () => {
		(db.transaction as any).mockImplementation(async (callback: any) => {
			const mockTx = {};
			return await callback(mockTx);
		});

		const mockRoute = {
			id: "123",
			name: "Original",
			path: "/original",
			method: HttpMethod.GET,
			projectId: "proj2",
			active: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		(getRouteByNameOrPath as any).mockResolvedValueOnce(mockRoute);
		(updateRoute as any).mockResolvedValueOnce({
			...mockRoute,
			path: "/updated",
		});

		const acl: AuthACL[] = [{ projectId: "*", role: "system_admin" }];
		const result = await handleRequest("123", { path: "/updated" }, acl);

		expect(result).toBeDefined();
	});

	// The AI harness edits a route's validation this way. Dropping the schemas
	// here made the whole edit a silent no-op: it applied, and nothing changed.
	describe("schemas", () => {
		const paramsSchema = {
			dataType: "object",
			properties: [{ key: "id", dataType: "str", required: true }],
		};

		function routeThatExists(overrides: Record<string, unknown> = {}) {
			(db.transaction as any).mockImplementation(async (callback: any) =>
				callback({}),
			);
			(getRouteByNameOrPath as any).mockResolvedValueOnce({
				id: "123",
				name: "Original",
				path: "/users/:id",
				method: HttpMethod.GET,
				projectId: "proj1",
				active: true,
				createdAt: new Date(),
				updatedAt: new Date(),
				...overrides,
			});
			(updateRoute as any).mockImplementationOnce(async (row: any) => row);
		}

		const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];

		it("writes a patched paramsSchema to the route", async () => {
			routeThatExists({ paramsSchema: null });

			await handleRequest("123", { paramsSchema } as any, acl);

			expect((updateRoute as Mock<any>).mock.calls.at(-1)![0]).toMatchObject({
				paramsSchema,
			});
		});

		it("refuses a paramsSchema that does not match the path", async () => {
			routeThatExists({ paramsSchema: null });

			await expect(
				handleRequest(
					"123",
					{
						paramsSchema: {
							dataType: "object",
							properties: [{ key: "slug", dataType: "str", required: true }],
						},
					} as any,
					acl,
				),
			).rejects.toThrow(/paramsSchema/);
		});

		// An omitted field is skipped by the update statement, so the dead schema
		// would otherwise survive the edit and keep validating params that can no
		// longer be supplied.
		it("clears a stale paramsSchema when the path loses its parameters", async () => {
			routeThatExists({ paramsSchema });

			await handleRequest("123", { path: "/users" }, acl);

			expect((updateRoute as Mock<any>).mock.calls.at(-1)![0]).toMatchObject({
				path: "/users",
				paramsSchema: null,
			});
		});

		it("leaves schemas alone when the patch touches neither them nor the path", async () => {
			routeThatExists({ paramsSchema, bodySchema: { dataType: "object" } });

			await handleRequest("123", { active: false }, acl);

			expect((updateRoute as Mock<any>).mock.calls.at(-1)![0]).toMatchObject({
				paramsSchema,
				active: false,
			});
		});
	});

	it("should throw NotFoundError when route not found", async () => {
		(db.transaction as any).mockImplementation(async (callback: any) => {
			const mockTx = {};
			return await callback(mockTx);
		});

		(getRouteByNameOrPath as any).mockResolvedValueOnce(null);

		const acl: AuthACL[] = [{ projectId: "proj1", role: "creator" }];
		await expect(
			handleRequest("123", { name: "Updated" }, acl),
		).rejects.toThrow(NotFoundError);
	});
});
