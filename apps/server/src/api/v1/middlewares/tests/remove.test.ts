import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const deleted = mock();
mock.module("../../../../db", () => ({
	db: { delete: () => ({ where: deleted }) },
}));

const compiled = mock();
mock.module("../../../../modules/compiler/publisher", () => ({
	requestMiddlewareCompile: compiled,
}));

import * as authCommon from "../../../auth/common";
import * as repo from "../repository";
import { remove } from "../service";

const caller = { user: { id: "user1", isSystemAdmin: false } as any, acl: [] };

describe("delete middleware", () => {
	beforeEach(() => {
		deleted.mockClear();
		compiled.mockClear();
		spyOn(repo, "getMiddleware").mockResolvedValue({ id: "mw-1", projectId: "proj-1" } as any);
		spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);
	});

	it("refuses while routes use it (#579)", async () => {
		spyOn(repo, "routesUsing").mockResolvedValue(["route-1", "route-2"]);

		await expect(remove("mw-1", caller)).rejects.toThrow(
			"Remove this middleware from the 2 routes that use it first.",
		);
		expect(deleted).not.toHaveBeenCalled();
		expect(compiled).not.toHaveBeenCalled();
	});

	it("deletes an unused one and drops its artifact", async () => {
		spyOn(repo, "routesUsing").mockResolvedValue([]);

		await remove("mw-1", caller);

		expect(deleted).toHaveBeenCalledTimes(1);
		expect(compiled).toHaveBeenCalledWith("mw-1", "proj-1", "middleware deleted");
	});
});
