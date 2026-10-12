import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

const deleted = mock();
mock.module("../../../../db", () => ({
	db: {
		transaction: async (run: (tx: unknown) => unknown) =>
			await run({ delete: () => ({ where: deleted }) }),
	},
}));

const compiled = mock();
mock.module("../../../../modules/compiler/publisher", () => ({
	requestMiddlewareCompile: compiled,
}));

// the finder is tested against a real database (modules/deployments/tests/blockReferences)
const assertNotInUse = mock(async (..._args: unknown[]) => {});
mock.module("../../../../modules/references/service", () => ({ assertNotInUse }));

import * as authCommon from "../../../auth/common";
import * as repo from "../repository";
import { remove } from "../service";

const caller = { user: { id: "user1", isSystemAdmin: false } as any, acl: [] };

describe("delete middleware", () => {
	beforeEach(() => {
		deleted.mockClear();
		compiled.mockClear();
		assertNotInUse.mockReset();
		assertNotInUse.mockResolvedValue(undefined);
		spyOn(repo, "getMiddleware").mockResolvedValue({
			id: "mw-1",
			name: "auth",
			projectId: "proj-1",
		} as any);
		spyOn(authCommon, "hasProjectAccess").mockReturnValue(true);
	});

	it("refuses while the finder says a route uses it, in a working copy or a promoted version (#579, #740)", async () => {
		assertNotInUse.mockRejectedValue(new Error("This middleware is still used by route \"orders\""));

		await expect(remove("mw-1", caller)).rejects.toThrow("still used by");
		expect(assertNotInUse).toHaveBeenCalledWith(
			"middleware",
			{ id: "mw-1", name: "auth", projectId: "proj-1" },
			expect.anything(),
		);
		expect(deleted).not.toHaveBeenCalled();
		expect(compiled).not.toHaveBeenCalled();
	});

	it("deletes an unused one and drops its artifact", async () => {
		await remove("mw-1", caller);

		expect(deleted).toHaveBeenCalledTimes(1);
		expect(compiled).toHaveBeenCalledWith("mw-1", "proj-1", "middleware deleted");
	});
});
