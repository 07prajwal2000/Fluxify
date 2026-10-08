import { describe, expect, it, mock } from "bun:test";
import { db } from "../../../../../db";
import { type AuthACL, HttpMethod } from "../../../../../db/schema";
import { ForbiddenError } from "../../../../../errors/forbidError";
import handleRequest from "../service";

mock.module("../../../../../db", () => ({
	db: { transaction: mock() },
}));
mock.module("../../../../../db/redis", () => ({
	publishMessage: mock(),
	CHAN_ON_ROUTE_CHANGE: "",
}));
mock.module("../repository", () => ({
	getRouteById: mock(),
	findRouteConflict: mock(async () => undefined),
	updateRoute: mock(),
}));

const { getRouteById, updateRoute } = await import("../repository");

describe("update route", () => {
	it("should throw ForbiddenError when user is only a viewer of the project", async () => {
		(db.transaction as any).mockImplementation(async (callback: any) => callback({}));
		(getRouteById as any).mockResolvedValueOnce({
			id: "123",
			name: "Original",
			path: "/original",
			method: HttpMethod.GET,
			projectId: "proj1",
		});

		const acl: AuthACL[] = [{ projectId: "proj1", role: "viewer" }];
		await expect(
			handleRequest(
				"123",
				{ name: "Updated", path: "/original", method: HttpMethod.GET } as any,
				acl,
			),
		).rejects.toThrow(ForbiddenError);
		expect(updateRoute).not.toHaveBeenCalled();
	});
});
